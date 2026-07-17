import { listProjects } from '@/lib/project-service';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const projects = await listProjects();

  return (
    <DashboardClient initialProjects={projects} />
  );
}
