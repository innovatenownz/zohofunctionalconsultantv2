import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function getSession() {
  if (process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT_TEST === 'true') {
    return {
      user: {
        name: 'Test User',
        email: 'test@example.com',
        image: 'https://example.com/test.png'
      }
    };
  }
  return await getServerSession(authOptions);
}
