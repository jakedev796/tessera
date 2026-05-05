'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SkillFavoriteButton } from './skill-favorite-button';
import type { SkillInfo } from '@/hooks/use-skill-picker';

interface SkillQuickAccessBarProps {
  sessionId?: string;
  onSelectSkill: (skill: SkillInfo) => void;
  trailingContent?: ReactNode;
}

export function SkillQuickAccessBar({ sessionId, onSelectSkill, trailingContent }: SkillQuickAccessBarProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 px-3 py-1.5',
      )}
    >
      <SkillFavoriteButton sessionId={sessionId} onSelectSkill={onSelectSkill} />
      {trailingContent && (
        <div
          className="composer-quick-access-controls ml-auto flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden"
          data-testid="skill-quick-access-controls"
        >
          {trailingContent}
        </div>
      )}
    </div>
  );
}
