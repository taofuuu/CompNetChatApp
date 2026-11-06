import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export interface Question {
  title: string;
  text: string;
  /** The label of the button that says yes. */
  action: string;
}

/**
 * The page's own confirm(): `confirm` opens a popup and resolves to whether the User said yes. Render the `popup` once.
 * A modal <dialog>, so the browser keeps the focus inside, closes it on Esc, and hands the focus back.
 */
export function useConfirm() {
  const ref = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState<Question>();

  async function confirm(next: Question) {
    const dialog = ref.current;
    // A late answer to Leave Group can ask while the popup is open: one click must not answer two questions.
    if (!dialog || dialog.open) return false;
    // Before opening, so the popup never shows the last question.
    flushSync(() => setQuestion(next));
    // Esc keeps the value, so the last yes mustn't still be here.
    dialog.returnValue = '';
    dialog.showModal();
    await new Promise((closed) => dialog.addEventListener('close', closed, { once: true }));
    return dialog.returnValue === 'yes';
  }

  const popup = (
    <dialog ref={ref} className="confirm enter" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <form method="dialog">
        <h2 id="confirm-title">{question?.title}</h2>
        <p id="confirm-text">{question?.text}</p>
        <div className="confirm-actions">
          {/* First, so the popup opens with the focus here and a stray Enter destroys nothing. */}
          <button className="button button-quiet">Cancel</button>
          <button className="button" value="yes">
            {question?.action}
          </button>
        </div>
      </form>
    </dialog>
  );

  return [confirm, popup] as const;
}
