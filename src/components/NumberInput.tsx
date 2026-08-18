'use client';

import { useEffect, useRef, useState } from 'react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (next: number) => void;
};

/**
 * A number field you can actually clear.
 *
 * A controlled `<input type="number">` bound straight to a number coerces an
 * empty box back to 0, so the next keystroke lands after that zero and you get
 * "0192.75". Holding the raw text locally keeps the box empty while it is
 * empty, and still reports a usable number to the caller.
 */
export default function NumberInput({ value, onValueChange, ...rest }: Props) {
  const [text, setText] = useState(() => String(value));
  const typing = useRef(false);

  // Adopt changes that came from elsewhere — an undo, a save, a reset — but
  // never fight whoever is mid-keystroke.
  useEffect(() => {
    if (typing.current) {
      typing.current = false;
      return;
    }
    if (Number(text) !== value) setText(String(value));
  }, [value, text]);

  return (
    <input
      {...rest}
      type="number"
      value={text}
      onChange={(e) => {
        typing.current = true;
        setText(e.target.value);
        const parsed = Number(e.target.value);
        onValueChange(e.target.value.trim() === '' || !Number.isFinite(parsed) ? 0 : parsed);
      }}
    />
  );
}
