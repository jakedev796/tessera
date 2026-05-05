import { LoginForm } from '@/components/auth/login-form';
import { redirect } from 'next/navigation';
import { isElectronAuthBypassEnabled } from '@/lib/auth/electron-mode';
import { hasAnyUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (isElectronAuthBypassEnabled()) {
    redirect('/');
  }

  if (!(await hasAnyUsers())) {
    redirect('/setup');
  }

  return <LoginForm />;
}
