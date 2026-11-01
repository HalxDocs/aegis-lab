import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Virtual nanoseconds per real millisecond at 1×.
 *
 * 120,000 ns/ms means 120ms of story per second of wall time, so the canonical
 * 1,200ms run takes about ten seconds.
 */
const BASE_RATE = 120_000;

export function usePlayback(horizon: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const frame = useRef<number | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    last.current = null;

    const tick = (now: number) => {
      const previous = last.current ?? now;
      const delta = Math.min(80, now - previous);
      last.current = now;
      setTime((current) => Math.min(horizon, current + delta * BASE_RATE * speed));
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [playing, speed, horizon]);

  useEffect(() => {
    if (time >= horizon) setPlaying(false);
  }, [time, horizon]);

  const play = useCallback(() => {
    setTime((current) => (current >= horizon ? 0 : current));
    setPlaying(true);
  }, [horizon]);

  const pause = useCallback(() => setPlaying(false), []);

  const toggle = useCallback(() => {
    if (playing) {
      setPlaying(false);
    } else {
      play();
    }
  }, [playing, play]);

  const seek = useCallback(
    (value: number) => {
      setPlaying(false);
      setTime(Math.min(horizon, Math.max(0, value)));
    },
    [horizon],
  );

  const reset = useCallback(() => {
    setPlaying(false);
    setTime(0);
  }, []);

  return { time, playing, speed, setSpeed, play, pause, toggle, seek, reset };
}
