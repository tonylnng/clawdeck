const VERSION = 'v1.5.3';

export function Footer() {
  return (
    <footer className="w-full py-2 px-4 text-center text-xs text-muted-foreground border-t bg-card">
      Powered by{' '}
      <a
        href="https://toniclab.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-foreground underline underline-offset-2 transition-colors"
      >
        toniclab.ai
      </a>
      {' · '}
      {VERSION}
    </footer>
  );
}
