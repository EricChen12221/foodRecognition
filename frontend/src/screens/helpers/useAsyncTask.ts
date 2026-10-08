import { useCallback, useEffect, useRef, useState } from 'react';

export type Status = 'idle' | 'loading' | 'success' | 'error';

/**
 * Runs an async task and tracks idle / loading / success / error.
 * - cancel() aborts the request and ignores any late response
 * - a timeout aborts the request and reports an error
 * - starting a new run supersedes the old one, so stale results never overwrite new ones
 * - leaving the screen aborts any request still in flight
 */
export function useAsyncTask<T, A extends unknown[]>(
  task: (signal: AbortSignal, ...args: A) => Promise<T>,
  timeoutMs = 120000,
) {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const taskRef = useRef(task);          // always the latest task, without changing run()
  taskRef.current = task;
  const runId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    runId.current += 1;                  // anything in flight is now stale
    controller.current?.abort();
    setStatus('idle');
  }, []);

  const run = useCallback(
    async (...args: A) => {
      controller.current?.abort();
      const id = ++runId.current;
      const ctrl = new AbortController();
      controller.current = ctrl;

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);

      setStatus('loading');
      setError(null);
      setData(null);
      try {
        const result = await taskRef.current(ctrl.signal, ...args);
        if (id !== runId.current) return;
        setData(result);
        setStatus('success');
      } catch (e) {
        if (id !== runId.current) return;
        setError(
          timedOut
            ? 'This is taking too long. Please try again.'
            : e instanceof Error
              ? e.message
              : 'Something went wrong.',
        );
        setStatus('error');
      } finally {
        clearTimeout(timer);
      }
    },
    [timeoutMs],
  );

  useEffect(
    () => () => {
      runId.current += 1;
      controller.current?.abort();
    },
    [],
  );

  return { status, data, error, run, cancel };
}