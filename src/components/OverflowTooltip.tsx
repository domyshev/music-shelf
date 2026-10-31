import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '@mui/material';

/** Reveal full text only when its own rendered box is truncated. */
export function OverflowTooltip({ text, children, className = '' }: { text: string; children?: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const check = () => {
      const child = node.firstElementChild;
      setOverflow(node.scrollWidth > node.clientWidth + 1 || Boolean(child && child.scrollWidth > child.clientWidth + 1));
    };
    check();
    const observer = new ResizeObserver(check); observer.observe(node);
    void document.fonts.ready.then(check);
    return () => observer.disconnect();
  }, [text]);
  return <Tooltip title={overflow ? text : ''} arrow placement="right" slotProps={{ popper: { modifiers: [{ name: 'flip', options: { fallbackPlacements: ['left'] } }] } }}><span ref={ref} className={`overflow-text ${className}`} tabIndex={overflow && !children ? 0 : undefined}>{children ?? text}</span></Tooltip>;
}
