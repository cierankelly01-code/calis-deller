import { identity } from '@/lib/security/server';
import { redirect } from 'next/navigation';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await identity(false);
  if (!user) redirect('/login?next=/settings');
  if (user.role !== 'manager') return <main className="p-8">Manager access required.</main>;
  return <>{children}</>;
}
