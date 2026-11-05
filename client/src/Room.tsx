import type { ClientToServerEvents, Message, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Banner } from './Banner';

export const BOT_NAME = 'bot';
/** A citation as the server writes it, e.g. 📖 Lesson 3 (Transport Layer), slide 42 */
const CITATION = /📖[^\n📖]*/gu;
/** Often enough that the other side's bubble, shown for 3 s, stays steady while the User types. */
const TYPING_EVERY_MS = 2_000;

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  roomId: string;
  title: string;
  /** The line under the title: a Group's Member count, or whether the other User is Online. */
  subtitle: string;
  messages: Message[];
  /** The bot's reply so far, empty before its first word, or undefined when it isn't answering. */
  botDraft?: string;
  /** The other Users typing here right now. */
  typers: string[];
  /** The viewer's lowercase username. */
  me: string;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** A bot reply, with its Slide citations set apart like footnotes. */
function BotText({ text }: { text: string }) {
  return (
    <>
      <div className="message-text">{text.replace(CITATION, '').trim()}</div>
      {text.match(CITATION)?.map((citation) => (
        <cite key={citation} className="message-citation">
          {citation}
        </cite>
      ))}
    </>
  );
}

/** What a bubble shows before its words: bot thinking, or a User typing. */
function Dots({ label }: { label: string }) {
  return (
    <span className="dots" role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * A Room panel: displays message history in a scrollable message window
 * and provides a text box for sending Messages.
 */
export function Room({ socket, roomId, title, subtitle, messages, botDraft, typers, me }: Props) {
  const [inputText, setInputText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Only Messages after these rise into view: the history is already there when a Room opens.
  const [historyLength] = useState(messages.length);
  const logRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  /** False while the User has scrolled up to read, so new Messages don't pull them away. */
  const followsNewest = useRef(true);
  const lastTyping = useRef(0);

  // A layout effect, so a Room is already at its newest Message when the transition into it takes its snapshot.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || !followsNewest.current) return;
    // Smooth only for a new Message: instant on opening, and while the bot streams, where it would lag behind the text.
    log.scrollTo({ top: log.scrollHeight, behavior: opened.current && !botDraft ? 'smooth' : 'auto' });
    opened.current = true;
  }, [messages, botDraft, typers.length]);

  function type(text: string) {
    setInputText(text);
    if (text && Date.now() - lastTyping.current >= TYPING_EVERY_MS) {
      lastTyping.current = Date.now();
      // Volatile: dropped while disconnected, not delivered late as if the User were typing then.
      socket.volatile.emit('typing', roomId);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    followsNewest.current = true;
    try {
      const result = await socket.timeout(10_000).emitWithAck('sendMessage', {
        roomId,
        text: inputText,
      });
      if (result.ok) {
        setInputText('');
        setError('');
        // Their Message took the bubble away, so the next word brings it straight back.
        lastTyping.current = 0;
      } else {
        setError(result.error);
      }
    } catch {
      setError('No answer from the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="room-panel" aria-label={`Room: ${title}`}>
      <header className="room-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>

      <div
        className="message-window"
        role="log"
        aria-label="Messages"
        ref={logRef}
        onScroll={({ currentTarget: log }) => {
          followsNewest.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        }}
      >
        {messages.length === 0 && typers.length === 0 ? (
          <p className="empty-history">No Messages yet. Say hello, or start with @bot to ask bot something.</p>
        ) : (
          <ul className="message-list">
            {messages.map((message, i) => {
              const isBot = message.sender === BOT_NAME;
              const isSelf = message.sender.toLowerCase() === me;
              const side = isBot ? 'message-bot' : isSelf ? 'message-self' : 'message-other';
              // Not the bot's: its last Message replaces the bubble that streamed it, which already rose.
              const enter = i >= historyLength && !isBot ? 'enter' : '';
              return (
                <li
                  key={`${message.sender}-${message.createdAt}-${i}`}
                  className={`message-item ${side} ${enter}`}
                >
                  <div className="message-header">
                    <strong className="message-sender">{message.sender}</strong>{' '}
                    <time className="message-time" dateTime={message.createdAt}>
                      {formatTime(message.createdAt)}
                    </time>
                  </div>
                  {isBot ? <BotText text={message.text} /> : <div className="message-text">{message.text}</div>}
                </li>
              );
            })}
            {botDraft !== undefined && (
              <li className="message-item message-bot enter">
                <div className="message-header">
                  <strong className="message-sender">{BOT_NAME}</strong>
                </div>
                {botDraft ? <BotText text={botDraft} /> : <Dots label="bot is thinking" />}
              </li>
            )}
            {typers.map((name) => (
              <li key={name} className="message-item message-other enter">
                <div className="message-header">
                  <strong className="message-sender">{name}</strong>
                </div>
                <Dots label={`${name} is typing`} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Banner text={error} />
      <form className="message-form" onSubmit={send}>
        {/* readOnly, not disabled: a disabled box would lose focus after every Message. */}
        <input
          aria-label={`Message ${title}`}
          value={inputText}
          onChange={(event) => type(event.target.value)}
          placeholder={`Message ${title}, or start with @bot to ask bot`}
          readOnly={busy}
          maxLength={1000}
          autoFocus
        />
        <button className="button" disabled={busy}>
          Send
        </button>
      </form>
    </section>
  );
}
