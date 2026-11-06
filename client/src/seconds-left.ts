import { useEffect, useState } from 'react';

/** The whole seconds until `endsAt` on the `performance.now()` clock, ticking until it reaches 0. */
export function useSecondsLeft(endsAt: number) {
  const [now, setNow] = useState(() => performance.now());
  const secondsLeft = Math.max(Math.ceil((endsAt - now) / 1000), 0);
  const running = secondsLeft > 0;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return secondsLeft;
}
