'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  selectShouldShowWaitingIndicator,
  useChatStore,
} from '@/stores/chat-store';
import type { EnhancedMessage } from '@/types/chat';

/** Delay (ms) before showing the indicator to avoid flickering during brief gaps */
const SHOW_DELAY_MS = 400;
const ASSISTANT_TEXT_GRACE_MS = 1200;

function getContentLength(content: Extract<EnhancedMessage, { type: 'text' }>['content']): number {
  if (typeof content === 'string') {
    return content.length;
  }

  return content.reduce((total, block) => {
    if (block.type === 'text') {
      return total + block.text.length;
    }
    if (block.type === 'image') {
      return total + block.source.data.length;
    }
    return total;
  }, 0);
}

function getLastAssistantTextSignature(messages: EnhancedMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type === 'text' && message.role === 'assistant') {
      return `${message.id}:${getContentLength(message.content)}`;
    }
  }

  return null;
}

/**
 * Determines whether the waiting indicator should be shown.
 *
 * Shows the indicator whenever this session's turn is active, except while a
 * text chunk is buffered and about to render as assistant text.
 *
 * Intentionally does NOT hide during thinking streaming, tool execution,
 * or MCP progress: those are exactly the silent gaps that previously made
 * the chat feel frozen.
 *
 * A debounce delay is applied to the false→true transition to prevent
 * flickering during rapid tool-call gaps.
 */
export function useShowWaitingIndicator(
  sessionId: string,
  messages: EnhancedMessage[]
): boolean {
  const shouldShow = useChatStore(selectShouldShowWaitingIndicator(sessionId));
  const lastAssistantTextSignature = useMemo(
    () => getLastAssistantTextSignature(messages),
    [messages],
  );
  const previousAssistantTextSignatureRef = useRef<string | null>(null);
  const lastAssistantTextChangedAtRef = useRef(0);

  // Debounce: delay showing (false→true) to avoid flicker, hide immediately (true→false)
  const [debouncedShow, setDebouncedShow] = useState(false);

  useEffect(() => {
    if (!lastAssistantTextSignature) {
      previousAssistantTextSignatureRef.current = null;
      lastAssistantTextChangedAtRef.current = 0;
      return;
    }

    if (lastAssistantTextSignature !== previousAssistantTextSignatureRef.current) {
      previousAssistantTextSignatureRef.current = lastAssistantTextSignature;
      lastAssistantTextChangedAtRef.current = Date.now();
    }
  }, [lastAssistantTextSignature]);

  useEffect(() => {
    if (!shouldShow) {
      const frameId = requestAnimationFrame(() => setDebouncedShow(false));
      return () => cancelAnimationFrame(frameId);
    }

    const resetFrameId = requestAnimationFrame(() => setDebouncedShow(false));
    const elapsedSinceAssistantText = lastAssistantTextChangedAtRef.current > 0
      ? Date.now() - lastAssistantTextChangedAtRef.current
      : ASSISTANT_TEXT_GRACE_MS;
    const showDelayMs = Math.max(
      SHOW_DELAY_MS,
      ASSISTANT_TEXT_GRACE_MS - elapsedSinceAssistantText,
    );
    const timer = setTimeout(() => setDebouncedShow(true), showDelayMs);

    return () => {
      cancelAnimationFrame(resetFrameId);
      clearTimeout(timer);
    };
  }, [shouldShow, lastAssistantTextSignature]);

  return debouncedShow;
}
