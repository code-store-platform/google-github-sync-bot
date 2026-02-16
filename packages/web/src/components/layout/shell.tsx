import { Sidebar } from './sidebar';

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="md:pl-64">
        <div className="mx-auto max-w-6xl p-6 pt-16 md:pt-6">{children}</div>
      </main>
    </div>
  );
}
