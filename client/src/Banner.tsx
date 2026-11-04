import { useState } from 'react';

/** An alert that slides open for `text` and closed when it's empty, keeping its last words while it closes. */
export function Banner({ text }: { text: string }) {
  const [lastText, setLastText] = useState(text);
  if (text && text !== lastText) setLastText(text);
  return (
    <div className={`banner ${text ? 'banner-open' : ''}`}>
      <div>
        <p role="alert">{text || lastText}</p>
      </div>
    </div>
  );
}
