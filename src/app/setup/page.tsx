import { SetupClient } from '@/components/setup/setup-client';
import { isElectronAuthBypassEnabled } from '@/lib/auth/electron-mode';
import { hasAnyUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const initialNeedsAccountSetup =
    !isElectronAuthBypassEnabled() && !(await hasAnyUsers()) ? true : null;

  return <SetupClient initialNeedsAccountSetup={initialNeedsAccountSetup} />;
}
