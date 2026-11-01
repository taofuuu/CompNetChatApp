# Lesson: how @bot works

The AI feature from [#5](https://github.com/taofuuu/CompNetChatApp/issues/5) and [#12](https://github.com/taofuuu/CompNetChatApp/issues/12), explained so you can present it and change it later.

Read it in order. Part 1 gives the idea, Part 2 the steps, Part 3 the code, Part 4 the decisions and their alternatives.

---

## 1. Overview

### What a User sees

In a Private Room, Alice sends `@bot TCP กับ UDP ต่างกันยังไง`. A reply from **bot** grows word by word on Alice's and Bob's screens, in the language she wrote in, then stays in the Room's history like any other Message. If the AI fails or stays silent for 10 seconds, bot replies "bot is unavailable right now" and the chat carries on.

### The five ideas behind it

1. **A chat model is a function, not a person.** You send a list of messages and get text back. The roles are `system` (rules for the bot), `user` (people) and `assistant` (the bot's earlier answers).
2. **The model remembers nothing.** Every call sends the rules plus the last 6 Messages again. That list is the only "memory" it has.
3. **"OpenAI-compatible" is a format, not a company.** Typhoon accepts the same request shape as OpenAI, so the official `openai` package works once `baseURL` points at Typhoon.
4. **Streaming means reading the answer while it is being written.** With `stream: true` the HTTP response stays open and delivers small pieces. The code reads them with `for await`.
5. **The key stays on the server.** The browser never talks to Typhoon. It only sees Socket.IO events, so the key can't leak through the page.

### How it fits the app

```
 Alice's browser                 NestJS server (:3000)                     Typhoon
 ┌──────────────┐  WebSocket   ┌────────────────────────────┐   HTTPS   ┌───────────┐
 │ Room.tsx     │─sendMessage─▶│ MessagesGateway            │           │ OpenAI-   │
 │              │◀──message────│   1. save and broadcast    │           │ compatible│
 │ draft bubble │◀──botChunk───│   2. mentionsBot? ─────┐   │           │ API       │
 │ final Message│◀──message────│   3. save and broadcast│   │           │           │
 └──────────────┘              │                        ▼   │           │           │
                               │ BotService.reply(history)  │           │           │
 Bob's browser                 │   └▶ AiClient.stream() ────┼──────────▶│           │
 (the same events)             └──────────┬─────────────────┘◀ chunks ──┤           │
                                          │ Mongoose                    └───────────┘
                                     MongoDB Atlas
```

There are two different connections here. Browser to server is the app's **WebSocket**. Server to Typhoon is a plain **HTTPS** request whose response arrives as Server-Sent Events.

---

## 2. High-level steps

What happens for one `@bot` Message:

1. Alice's Client emits `sendMessage`. Nothing about it is bot-specific.
2. `MessagesGateway` saves it through `MessagesService.send`, then broadcasts it to both Users.
3. `mentionsBot` sees that the text starts with `@bot`. The gateway starts `answerAsBot` **without waiting for it** and acknowledges Alice immediately.
4. `answerAsBot` loads the Room's last 6 Messages.
5. `BotService` turns them into the model's message list, with the system prompt first.
6. `AiClient` opens the streaming request and yields each piece of text.
7. Each piece goes to both Users as a `botChunk` event, and the client adds it to a temporary bubble.
8. When the stream ends, the full reply is saved as a Message from `bot` and broadcast as a normal `message`.
9. Each client removes the temporary bubble when that Message arrives, so the reply is in the list exactly once.

On failure, steps 6 and 7 stop early and `BotService` returns "bot is unavailable right now". Step 8 then runs as usual, so failures need no special path on the client.

---

## 3. The code in detail

### New files: `server/src/bot/`

| File | Lines | Job |
|---|---|---|
| `bot-name.ts` | 2 | The constant `BOT_NAME`, so `UsersService` can use it without importing the AI code |
| `prompt.ts` | 6 | The system prompt |
| `ai.client.ts` | 43 | The only file that knows an AI API exists |
| `bot.service.ts` | 47 | Decides what to ask and what happens on failure |
| `bot.module.ts` | 9 | NestJS wiring |

### `prompt.ts`: the rules

The system prompt tells the model who it is, that two people are chatting, which message to answer, to reply in that message's language, and to stay under 5 sentences in plain text. Each line exists for a reason: without "the latest message that mentions @bot", the model may answer every message in the context. Plain text matters because the client doesn't render Markdown, so `**bold**` would show its asterisks.

### `ai.client.ts`: talking to the model

```ts
async *stream(messages: AiMessage[]): AsyncGenerator<string> {
```

The `*` makes this a **generator**: a function that hands out values one at a time with `yield`. `async *` allows waiting between them, which suits a network stream. The caller writes `for await (const text of ai.stream(...))`.

```ts
const { AI_BASE_URL: baseURL, AI_MODEL: model, AI_API_KEY: apiKey } = process.env;
if (!baseURL || !model || !apiKey) throw new Error(...);
```

The variables are read on every call, not at startup, so a missing key produces the fallback reply instead of stopping the app. All three are required because without `baseURL` the SDK would quietly send your request and key to OpenAI.

```ts
const client = new OpenAI({ baseURL, apiKey, maxRetries: 0 });
```

The SDK retries twice by default. A retry would push the wait past 10 seconds, so retries are off.

```ts
const abort = new AbortController();
let silence = setTimeout(() => abort.abort(), SILENCE_LIMIT_MS);
```

An `AbortController` is a cancel button for a request. The timer presses it after 10 seconds. Each time text arrives, the timer is cleared and restarted, so the limit measures **silence**, not total time.

`for await (const chunk of stream)` reads the pieces. `chunk.choices[0]?.delta.content` is the new text; some chunks carry none (the first holds only the role), and those are skipped. `finally` clears the timer on every exit, including errors, so no timer is left running.

`max_tokens: 500` caps the reply length, as a safety net behind the prompt's "5 sentences".

### `bot.service.ts`: the decisions

```ts
export function mentionsBot(text: string) {
  return /^@bot(\s|$)/i.test(text);
}
```

`^` is the start of the text, `(\s|$)` means a space or the end follows, and `i` ignores case. So `@bot hi`, `@BOT hi` and a bare `@bot` count, while `@bottle` and `hi @bot` don't. `send` trims the text first, so leading spaces are fine.

`reply(history, onChunk)` adds up the pieces, passes each to `onChunk`, and returns the whole text. Its `catch` turns **any** error into `BOT_UNAVAILABLE`, and `reply.trim() || BOT_UNAVAILABLE` handles an empty answer. It never throws, which makes the gateway's job simple.

Note that `onChunk` is a callback. `BotService` has no idea what happens to a chunk, so it stays free of sockets and the database.

`toAiMessages` builds the list for the model:

- The system prompt goes first.
- Failure notices are filtered out, or the model might repeat that it's unavailable.
- bot's Messages become `assistant`; everyone else's become `user` as `Alice: text`. The name prefix is how the model tells two people apart, since both are `user`.

### `messages.gateway.ts`: joining it to the chat

```ts
if (mentionsBot(result.message.text)) void this.answerAsBot(result.message.roomId);
return { ok: true };
```

There's no `await`, on purpose. Alice's client gives up after 10 seconds without an acknowledgement, and the AI may take that long. `void` tells the reader, and the linter, that ignoring the promise is intended.

That choice has a cost: nobody catches an error in `answerAsBot`, and an unhandled rejection stops a Node server. So its body sits in `try/catch`. If the database fails, the `catch` sends an unsaved notice so the bubble doesn't stay stuck on screen. `finally` always releases the Room.

`botAnswering` is a `Set` of Rooms with a reply in progress. Each Room has one streaming bubble, so a second reply at the same time would mix into it.

`toRoom(roomId)` replaces the old inline `split(':')`, now that three places emit to a Room. It targets the `user:<name>` Socket.IO rooms from #8, which reach every Client of both Users.

### `messages.service.ts`: small additions

- `recent(roomId, limit)` sorts newest first to get the last N, then reverses them back into reading order.
- `saveBotReply` skips `send`'s checks: bot isn't one of the Room's two Users, and a reply may be over the 1000-character limit for Users.
- The private `save` and `toSharedMessage` replace repeated code in `#8`'s `send` and `loadHistory`.

### `messages.module.ts`: one import

`MessagesModule` imports `BotModule`, and that's the only link between them. See decision 3 below.

### `users.service.ts`: nobody can be bot

`register` refuses the name in any case. `logIn` refuses it too, because an account named `bot` might already exist in Atlas from testing, and it would then be able to post as the bot.

### `shared/index.ts`: the contract

One new event, `botChunk: { roomId, text }`. The finished reply is a normal `Message`, so nothing else changed.

### Client: `App.tsx` and `Room.tsx`

`App` holds `botDrafts`, the text so far by Room. It lives in `App` rather than `Room` so chunks aren't lost while you're viewing another Room. `botChunk` appends to it, a `message` from bot clears it, and a reconnect clears it too, because the history reload already has the finished reply.

`Room` shows the draft as a last list item and gives bot's Messages the purple `message-bot` style. Scrolling is instant while streaming, since one smooth animation per chunk would lag behind the text.

---

## 4. Design choices and alternatives

Each row marks what was chosen and what it was weighed against.

### 1. Where the AI runs

| Option | Trade-off |
|---|---|
| **Hosted API (Typhoon)** ✅ | Free, Thai-first, nothing to run. Depends on someone else's service, hence the fallback reply |
| Run a model yourself (Ollama) | Private and offline, but it needs a GPU and won't fit Render's free tier |

### 2. How to call it

| Option | Trade-off |
|---|---|
| **`openai` package with `baseURL`** ✅ | Streaming parser and types included. Switching to Gemini changes only env variables |
| Plain `fetch` | No dependency, but you'd write your own Server-Sent Events parser, the easiest part to get subtly wrong |
| LangChain | Far more than one prompt needs, and it hides the part you wanted to learn |

### 3. How the bot joins the Message flow

| Option | Trade-off |
|---|---|
| **Gateway calls `BotService`, and `BotService` knows nothing about Messages storage** ✅ | One-way dependency, and `BotService` stays small and easy to test. The gateway does a little more |
| `BotService` saves and broadcasts by itself | Tidier gateway, but `BotModule` and `MessagesModule` would need each other: a circular import, which NestJS only allows with a `forwardRef` workaround |
| Event bus (`@nestjs/event-emitter`) | Fully decoupled, but it adds a dependency and hides the flow for a single listener |

### 4. How to stream to the browser

| Option | Trade-off |
|---|---|
| **`botChunk` events, then one normal `message`** ✅ | Chunks are throwaway, so only finished replies are saved. A client that missed some still ends up correct, because the final Message has the full text |
| Save each chunk or update one saved Message repeatedly | History would always be current, but it means ~100 database writes per reply |
| Only send the final reply | Simplest by far (about 60 fewer lines), but #5 lists streaming as a stretch goal, and a 3-second blank wait feels slower |

### 5. What the 10-second limit measures

| Option | Trade-off |
|---|---|
| **Silence: restart the timer on each piece** ✅ | Fits the promise that a slow start falls back, and never cuts off a long reply that's still flowing |
| Total time (`AbortSignal.timeout`) | One line, but a long reply could be cut off mid-sentence while working fine |

A partly written reply that then fails is replaced by the fallback. Keeping the partial text was the alternative, but a half-sentence with no warning is more confusing than an honest failure.

### 6. A second @bot during a reply

| Option | Trade-off |
|---|---|
| **Ignore it** ✅ | Two lines, no mixed bubbles, and it limits use of the API's rate limits. The second person gets no answer, which is the known weak spot |
| Queue it | Everyone gets an answer, but it adds a queue that can grow, for a rare case in a 2-person Room |
| Give each reply an id and let bubbles run in parallel | Correct, but the contract and client both get more complex |

A reply takes about 1.5 seconds with the current model, so this should rarely show up.

### 7. How much context

**The last 6 Messages** ✅, as #5 asks for "the last few". The full history would cost more and slow answers as a Room grows. Only the question would be simplest, but follow-ups like "and UDP?" would make no sense.

### 8. Reserving the name

**Refuse `bot` at register and log in** ✅, with a plain string `sender`. The alternative was a real `User` record for the bot or an `isBot` field on Messages. Those are more "correct", but they'd add a password-less User or a schema change to solve what one name check solves.

### 9. Known limits

- **Private Rooms only**, as #5 decided. When #11 (Group Messages) lands, `toRoom` needs to learn Groups, since it assumes a Room id holds two usernames.
- **The chat history goes to Typhoon.** The last 6 Messages of a Room leave the server whenever someone uses `@bot`, including the other person's. Worth a sentence in the demo.
- **Prompt injection is possible but harmless here.** A Message can say "ignore your rules". The bot has no tools and no data beyond its 6 Messages, so the worst result is a silly reply.
- **The bot has no automated tests.** They were removed to keep the PR small, so a later change could break it without CI noticing. The last version is in commit `d6e8fd4` (`server/test/bot.spec.ts` and `fake-ai.ts`) if you want them back.
- **`BOT_NAME` exists twice**, on server and client, because `shared` holds types only and nothing builds it.

---

## 5. What was actually checked

| Check | Result |
|---|---|
| Lint, build, the existing tests | Pass. None of these tests cover the bot |
| Real Typhoon, Thai question in the browser | Thai reply on both Users' screens |
| Real Typhoon, English question in the browser | English reply |
| Streaming seen on Bob's screen | The text grew in 76 page updates |
| Typhoon speed | First piece in about 0.5 s, whole reply in about 1.6 s |
| The `catch` that handles a database failure | **Not tested**, it's hard to trigger from the socket seam |
| Render deploy | **Not done**, needs your three variables |

---

## 6. For the Special Point 1 slide

**Feature:** @bot in Private Rooms. A User starts a Message with `@bot`, and an AI reply streams to both Users in Thai or English, using the Room's last 6 Messages as context.

**AI model:** Typhoon 2.5 (`typhoon-v2.5-30b-a3b-instruct`) by SCB 10X (ref. https://opentyphoon.ai/model/typhoon2-5).

**Code screenshot:** `AiClient.stream` in `server/src/bot/ai.client.ts` shows the most: the streaming call, the silence timer and the `yield`.

**AI prompt used:** the system prompt in `server/src/bot/prompt.ts`.

---

## 7. Try it yourself

Good first changes, each small:

- Change the system prompt to answer like a networking tutor, and ask the same question again.
- Change `BOT_CONTEXT_MESSAGES` in `bot.service.ts` to 2, and see a follow-up question lose its context.
- Set a wrong `AI_API_KEY` in `server/.env`, and watch the fallback appear.
- Change `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` to Gemini's, and see that no code changes.
