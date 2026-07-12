import { cookies } from 'next/headers';
import HomeClient from './HomeClient';
import { SESSION_COOKIE, verifyCookieValue, getUser } from '@/lib/session';

// Per-visitor greeting → never statically cache this route.
export const dynamic = 'force-dynamic';

export default async function Page() {
  // The cookie is issued/verified by middleware.ts before this renders.
  const raw = cookies().get(SESSION_COOKIE)?.value;
  const uid = verifyCookieValue(raw);

  // Look up a stored name for a returning visitor (best-effort; never block render).
  let userName: string | undefined;
  if (uid) {
    try {
      const user = await getUser(uid);
      userName = user?.name;
    } catch {
      // Redis unavailable — fall back to an anonymous greeting.
    }
  }

  return <HomeClient userName={userName} />;
}
