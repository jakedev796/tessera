'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { BoardPopoutLayout } from '@/components/board/board-popout-layout';

export default function BoardPopoutPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    checkAuth().finally(() => setAuthChecked(true));
  }, [checkAuth]);

  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      router.push('/login');
    }
  }, [authChecked, isAuthenticated, router]);

  if (!authChecked || !isAuthenticated || !user) {
    return null;
  }

  return <BoardPopoutLayout />;
}
