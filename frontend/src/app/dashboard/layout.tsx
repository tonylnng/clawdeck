'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Separator } from '@/components/ui/separator';
import Image from 'next/image';
import {
  Bot,
  MessageSquare,
  FileText,
  LogOut,
  Menu,
  X,
  Folder,
  Brain,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard/agents', icon: Bot, label: '🤖 Agents' },
  { href: '/dashboard/chat', icon: MessageSquare, label: '💬 Chat' },
  { href: '/dashboard/logs', icon: FileText, label: '📋 Logs' },
  { href: '/dashboard/workspace', icon: Folder, label: '📁 Workspace' },
  { href: '/dashboard/memory', icon: Brain, label: '🧠 Memory' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [username, setUsername] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then((data) => setUsername(data.username))
      .catch(() => router.push('/login'));
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  const Sidebar = ({ mobile = false }) => (
    <div className={`flex flex-col h-full ${mobile ? 'p-4' : 'p-4'}`}>
      {/* Logo */}
      <div className="flex items-center gap-2 mb-6">
        <Image src="/logo.png" alt="ClawDeck" width={28} height={28} />
        <span className="font-bold text-lg">ClawDeck</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <Separator className="my-4" />

      {/* User + Logout */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground px-3">{username}</p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r bg-card flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-56 h-full bg-card border-r flex flex-col">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
            <Sidebar mobile />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-2 p-3 border-b bg-card">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Image src="/logo.png" alt="ClawDeck" width={20} height={20} />
          <span className="font-semibold text-sm flex-1">ClawDeck</span>
          <ThemeToggle />
        </header>

        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-end px-4 py-2 border-b bg-card">
          <ThemeToggle />
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
