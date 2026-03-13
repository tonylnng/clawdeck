'use client';

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Button } from '@/components/ui/button';
import { ChevronRight, ChevronDown, Folder, File, Save, Edit, X, RefreshCw, Loader2 } from 'lucide-react';

const AGENTS = ['main', 'tonic-ai-tech', 'tonic-ai-workflow'];

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

interface FileContent {
  path: string;
  content: string;
  size: number;
  mtime: string;
}

function TreeNodeComponent({
  node,
  onSelect,
  selectedPath,
  level,
}: {
  node: TreeNode;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  level: number;
}) {
  const [expanded, setExpanded] = useState(level === 0);

  if (node.type === 'directory') {
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full text-left px-2 py-1 rounded hover:bg-accent text-sm"
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="mr-1">📁</span>
          <span className="truncate text-muted-foreground font-medium">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNodeComponent
                key={child.path}
                node={child}
                onSelect={onSelect}
                selectedPath={selectedPath}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={`flex items-center gap-1 w-full text-left px-2 py-1 rounded text-sm transition-colors ${
        selectedPath === node.path
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-accent text-muted-foreground hover:text-foreground'
      }`}
      style={{ paddingLeft: `${level * 16 + 20}px` }}
      onClick={() => onSelect(node.path)}
    >
      <span className="mr-1">📄</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export default function WorkspacePage() {
  const [selectedAgent, setSelectedAgent] = useState('main');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    setSelectedPath(null);
    setFileContent(null);
    setEditMode(false);
    try {
      const res = await fetch(`/api/workspace/${selectedAgent}/tree`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTree(data.tree || []);
    } catch (err) {
      setTreeError(String(err));
    } finally {
      setTreeLoading(false);
    }
  }, [selectedAgent]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const loadFile = async (filePath: string) => {
    setSelectedPath(filePath);
    setFileLoading(true);
    setFileError(null);
    setFileContent(null);
    setEditMode(false);
    setSaveMsg(null);
    try {
      const res = await fetch(
        `/api/workspace/${selectedAgent}/file?path=${encodeURIComponent(filePath)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: FileContent = await res.json();
      setFileContent(data);
      setEditContent(data.content);
    } catch (err) {
      setFileError(String(err));
    } finally {
      setFileLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedPath) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(
        `/api/workspace/${selectedAgent}/file?path=${encodeURIComponent(selectedPath)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content: editContent }),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setFileContent((prev) => prev ? { ...prev, content: editContent } : null);
      setEditMode(false);
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      setSaveMsg(`Error: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const isMarkdown = selectedPath?.endsWith('.md');
  const fileExtension = selectedPath?.split('.').pop() || 'text';

  return (
    <div className="flex h-full">
      {/* Left: Tree Panel */}
      <div className="w-64 flex-shrink-0 border-r bg-card flex flex-col">
        {/* Agent Selector */}
        <div className="p-3 border-b">
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="w-full text-sm bg-background border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {AGENTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {/* Tree Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Files</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadTree} disabled={treeLoading}>
            <RefreshCw className={`h-3 w-3 ${treeLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-y-auto p-1">
          {treeLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">Loading...</span>
            </div>
          )}
          {treeError && (
            <div className="p-3 text-sm text-red-500">{treeError}</div>
          )}
          {!treeLoading && !treeError && tree.map((node) => (
            <TreeNodeComponent
              key={node.path}
              node={node}
              onSelect={loadFile}
              selectedPath={selectedPath}
              level={0}
            />
          ))}
          {!treeLoading && !treeError && tree.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">No files found</div>
          )}
        </div>
      </div>

      {/* Right: Preview Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* File Header */}
        {selectedPath && (
          <div className="flex items-center justify-between px-4 py-2 border-b bg-card flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <File className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="text-sm font-mono truncate text-muted-foreground">{selectedPath}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {saveMsg && (
                <span className={`text-xs ${saveMsg.startsWith('Error') ? 'text-red-500' : 'text-green-500'}`}>
                  {saveMsg}
                </span>
              )}
              {editMode ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditMode(false)} disabled={saving}>
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveFile} disabled={saving}>
                    {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                    Save
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditMode(true)} disabled={!fileContent}>
                  <Edit className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          {!selectedPath && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Folder className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">Select a file to preview</p>
            </div>
          )}

          {fileLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading file...</span>
            </div>
          )}

          {fileError && (
            <div className="p-6 text-red-500 text-sm">{fileError}</div>
          )}

          {fileContent && !fileLoading && !fileError && (
            <>
              {editMode ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full p-4 font-mono text-sm bg-background resize-none focus:outline-none"
                  spellCheck={false}
                />
              ) : isMarkdown ? (
                <div className="p-6 prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      code({ node, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isInline = !match;
                        return !isInline ? (
                          <SyntaxHighlighter
                            style={oneDark}
                            language={match[1]}
                            PreTag="div"
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {fileContent.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <SyntaxHighlighter
                  style={oneDark}
                  language={fileExtension}
                  showLineNumbers
                  customStyle={{ margin: 0, borderRadius: 0, height: '100%', fontSize: '0.8rem' }}
                >
                  {fileContent.content}
                </SyntaxHighlighter>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
