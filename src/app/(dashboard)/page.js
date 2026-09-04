import { redirect } from 'next/navigation';
import { HOME_PATH } from '@/lib/routes';

// The root is the way in, not a destination. The edge proxy normally redirects
// before this ever renders; this is the fallback for the case where it doesn't.
// Both read HOME_PATH, so where the app opens is decided in one place.
export default function Home() {
  redirect(HOME_PATH);
}
