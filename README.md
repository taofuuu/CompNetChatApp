# CompNet Chat App

[![CI](https://github.com/taofuuu/CompNetChatApp/actions/workflows/ci.yml/badge.svg)](https://github.com/taofuuu/CompNetChatApp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/taofuuu/CompNetChatApp)](https://github.com/taofuuu/CompNetChatApp/releases/latest)
![Status](https://img.shields.io/badge/status-released-brightgreen)
[![Live demo](https://img.shields.io/badge/demo-live-46E3B7?logo=render&logoColor=white)](https://compnetchatapp.onrender.com)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)

A real-time, multi-user web chat app built for the Computer Networks term project on socket programming. Every Client talks to one central server over a WebSocket (Socket.IO, WebSocket transport only), so people on different computers can chat with each other live. An AI tutor, **bot**, answers course questions and cites the lecture slides it used.

**Live demo:** https://compnetchatapp.onrender.com

## Features

- **Accounts.** Register and log in with a username (unique ignoring case) and a hashed password. One User can be logged in on several Clients at once.
- **Online List.** Everyone sees who is Online right now, updated live.
- **Private Rooms.** A one-to-one Room between two Users, with its full history.
- **Groups.** Create a Group or join any Group by name, and see its whole history, even from before you joined. A Group is deleted, after a warning, when its last Member leaves.
- **Announcements.** The Room shows lines such as "bob joined the Group" and "alice kicked bob".
- **Member Panel.** Shows who is in the open Room, split into Online and Offline.
- **Typing indicator, unread counts, and Unsend.** You can unsend your own Messages at any time.
- **Kick and Vote Kick.**
  - **Kick:** a Member can kick an offline Member who joined after them.
  - **Vote Kick:** with at least 3 Members Online, any Member can start a 30-second vote against an Online Member. Members vote with F1 (yes) and F2 (no), and a strict majority removes the target. A kicked User can't rejoin that Group for 10 minutes.
- **Commands.** Type `/help` in any Room to see them all:

  | Command | Does |
  |---|---|
  | `/msg name` | Open the Private Room with an Online User |
  | `/join Group` | Join a Group and open it |
  | `/leave` | Leave this Group |
  | `/kick name` | Start a Vote Kick, or Kick an offline Member |
  | `/vote yes`, `/vote no` | Vote in a Vote Kick |
  | `/unsend` | Unsend your last Message here |
  | `@bot question` | Ask bot, in a Message everyone in the Room sees |

- **bot, the AI tutor.** Start a Message with `@bot` in any Room. bot reads the Room's recent Messages, looks up the relevant Slides from the course's Lessons, streams its answer, and cites up to two Slides, for example "Lesson 3 (Transport Layer), slide 42".

## Tech stack

| Part | Built with |
|---|---|
| Server | NestJS 11, Socket.IO gateways, Mongoose |
| Client | React 19, Vite |
| Shared | One TypeScript package with the socket event names and payload types |
| Database | MongoDB (Atlas) |
| AI | Any OpenAI-compatible API (Typhoon by default) |
| CI / hosting | GitHub Actions, Render |

Chat traffic uses the WebSocket transport only, with no fallback to HTTP long-polling. [ADR 0001](docs/adr/0001-socketio-websocket-only.md) explains why.

## Running it

You need Node 22 or later and a MongoDB connection string.

```bash
npm install
```

Copy `server/.env.example` to `server/.env` and fill in:

- `MONGODB_URI`: the MongoDB connection string.
- `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`: the AI behind bot. Without these the app still runs, and bot replies that it is unavailable.
- `PORT`: optional, defaults to 3000.

Never commit `.env`.

**Development.** Run each command in its own terminal, then open the address Vite prints:

```bash
npm run dev -w server
```

```bash
npm run dev -w client
```

**Production or a LAN demo.** Build, then start:

```bash
npm run build
```

```bash
npm start
```

The server serves both the page and the socket connection on one port. Other laptops on the same network open `http://<this laptop's IP>:3000`.

**Loading the Slides for bot.** The lecture PDFs are never committed, because the repo is public. Load them into the database by hand:

```bash
npm run slides:ingest -w server -- <folder of Lesson PDFs>
```

## Checks

`npm run lint`, `npm run build` and `npm test` run the same checks as CI. The server tests start the whole app against an in-memory MongoDB and connect real socket Clients. Every merge to `main` that passes CI deploys to Render.

## Project layout

```
server/   NestJS app: users, online-list, messages, groups, bot, slides
client/   React app
shared/   Socket event names and payload types used by both
docs/adr/ Decisions that must not be quietly undone
GLOSSARY.md  The domain words (User, Client, Room, Group, Vote Kick, ...)
```

## How it was built

A team of four built the app ticket by ticket from [GitHub Issues](../../issues). Every change was its own pull request, had to pass CI, and needed a teammate's approval. AI coding tools (Claude Code and chat assistants) wrote code against [GLOSSARY.md](GLOSSARY.md) and the ADRs, and each pull request description records the prompt that was used.
