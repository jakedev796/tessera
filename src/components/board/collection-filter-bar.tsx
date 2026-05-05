'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import type { Collection } from '@/types/collection';

interface CollectionFilterBarProps {
  collections: Collection[];
  activeFilter: string | null; // null = show all
  onFilter: (collectionId: string | null) => void;
}

/**
 * CollectionFilterBar -- horizontal pill-style filter chips.
 * "All" is always the first chip; each collection follows.
 */
export const CollectionFilterBar = memo(function CollectionFilterBar({
  collections,
  activeFilter,
  onFilter,
}: CollectionFilterBarProps) {
  const { t } = useI18n();
  const chipsRef = useRef<HTMLDivElement>(null);
  const [isChipScrollerOverflowing, setIsChipScrollerOverflowing] = useState(false);

  const updateChipScrollerOverflow = useCallback(() => {
    const chips = chipsRef.current;
    if (!chips) return;
    setIsChipScrollerOverflowing(chips.scrollWidth > chips.clientWidth + 1);
  }, []);

  useEffect(() => {
    updateChipScrollerOverflow();
    const chips = chipsRef.current;
    if (!chips) return;

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateChipScrollerOverflow);
      return () => window.removeEventListener('resize', updateChipScrollerOverflow);
    }

    const observer = new ResizeObserver(updateChipScrollerOverflow);
    observer.observe(chips);

    for (const child of Array.from(chips.children)) {
      observer.observe(child);
    }

    return () => observer.disconnect();
  }, [collections, updateChipScrollerOverflow]);

  const chipScroller = (
    <div
      ref={chipsRef}
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none"
      data-testid="collection-filter-chips"
    >
      {/* "All" chip */}
      <button
        type="button"
        onClick={() => onFilter(null)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1 rounded-2xl',
          'text-[0.75rem] font-medium whitespace-nowrap',
          'border cursor-pointer transition-all duration-150 select-none',
          activeFilter === null
            ? 'bg-(--accent) text-white border-(--accent)'
            : 'bg-(--sidebar-hover) text-(--text-muted) border-transparent hover:text-(--text-secondary) hover:bg-(--sidebar-active)',
        )}
        data-testid="collection-filter-all"
      >
        <Tag className="w-3 h-3" />
        <span>All</span>
      </button>

      {/* Collection chips */}
      {collections.map((col) => (
        <button
          type="button"
          key={col.id}
          onClick={() => onFilter(activeFilter === col.id ? null : col.id)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-2xl',
            'text-[0.75rem] font-medium whitespace-nowrap',
            'border cursor-pointer transition-all duration-150 select-none',
            activeFilter === col.id
              ? 'bg-(--accent) text-white border-(--accent)'
              : 'bg-(--sidebar-hover) text-(--text-muted) border-transparent hover:text-(--text-secondary) hover:bg-(--sidebar-active)',
          )}
          data-testid={`collection-filter-${col.id}`}
        >
          <Tag className="w-3 h-3" />
          <span>{col.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="flex min-w-0 shrink-0 items-center bg-(--board-bg) px-3 py-2"
      data-testid="collection-filter-bar"
    >
      {isChipScrollerOverflowing ? (
        <Tooltip
          content={t('task.board.horizontalScrollHint')}
          delay={350}
          wrapperClassName="flex-1"
        >
          {chipScroller}
        </Tooltip>
      ) : chipScroller}
    </div>
  );
});
