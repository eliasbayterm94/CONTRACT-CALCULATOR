'use client';

import { useState, useTransition } from 'react';
import { refreshRates } from '@/app/actions';

export default function RefreshRatesButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const res = await refreshRates();
            setMessage({ ok: res.ok, text: res.message });
          })
        }
      >
        {pending ? 'Fetching…' : 'Fetch live rates'}
      </button>
      {message && (
        <span
          className="text-[0.8125rem]"
          role="status"
          style={{ color: message.ok ? 'var(--accent)' : 'var(--danger)' }}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
