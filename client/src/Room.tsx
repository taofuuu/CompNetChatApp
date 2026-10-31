import type { ClientToServerEvents, Message, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  roomId: string;
  title: string;
  messages: Message[];
  /** The viewer's lowercase username. */
  me: string;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * A Room panel: displays message history in a scrollable message window
 * and provides a text box for sending Messages.
 */
export function Room({ socket, roomId, title, messages, me }: Props) {
  const [inputText, setInputText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await socket.timeout(10_000).emitWithAck('sendMessage', {
        roomId,
        text: inputText,
      });
      if (result.ok) {
        setInputText('');
        setError('');
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
        <h3>{title}</h3>
      </header>

      <div className="message-window" role="log" aria-label="Messages">
        {messages.length === 0 ? (
          <p className="empty-history">No messages yet.</p>
        ) : (
          <ul className="message-list">
            {messages.map((message, i) => {
              const isSelf = message.sender.toLowerCase() === me;
              return (
                <li
                  key={`${message.sender}-${message.createdAt}-${i}`}
                  className={`message-item ${isSelf ? 'message-self' : 'message-other'}`}
                >
                  <div className="message-header">
                    <strong className="message-sender">{message.sender}</strong>{' '}
                    <time className="message-time" dateTime={message.createdAt}>
                      {formatTime(message.createdAt)}
                    </time>
                  </div>
                  <div className="message-text">{message.text}</div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="message-form" onSubmit={send}>
        <input
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          placeholder="Type a message..."
          disabled={busy}
          maxLength={1000}
        />{' '}
        <button disabled={busy}>Send</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
