import React, { useState, useCallback, useRef, useEffect } from 'react';
import { generateWebAppCode, refineWebAppCode, WebFile } from './services/geminiService';
import { SparklesIcon, LoadingSpinnerIcon, CubeIcon, CodeBracketIcon, ClipboardIcon, ArchiveBoxIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, CheckIcon, DocumentIcon, GitHubIcon, XMarkIcon, ShareIcon, AikacungwenLogoIcon, UserIcon, PaperAirplaneIcon, IdeaIcon } from './components/icons';
import JSZip from 'jszip';

declare global {
  interface Window {
    prettier: any;
    prettierPlugins: any;
  }
}

type ActiveTab = 'preview' | 'code';

type RefinementChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
};

const suggestionPrompts = [
  {
    icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>,
    title: 'Create a portfolio',
    prompt: 'A portfolio website for a professional photographer.'
  },
  {
    icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>,
    title: 'Build a landing page',
    prompt: 'A modern landing page for a new SaaS application.'
  },
  {
    icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>,
    title: 'Make a to-do list app',
    prompt: 'A simple to-do list application to manage tasks.'
  },
  {
    icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>,
    title: 'Design a personal blog',
    prompt: 'A clean and minimal personal blog layout.'
  },
]


const CodeResult: React.FC<{ files: WebFile[], onFileContentChange: (files: WebFile[]) => void, isRefining: boolean }> = ({ files, onFileContentChange, isRefining }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('preview');
  const [selectedFile, setSelectedFile] = useState<string>(() => files.find(f => f.name === 'index.html')?.name || files[0]?.name || '');
  const [activePreviewPage, setActivePreviewPage] = useState<string>('index.html');
  const [formattedContent, setFormattedContent] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isGithubModalOpen, setIsGithubModalOpen] = useState<boolean>(false);
  const [lineCount, setLineCount] = useState(0);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
          if (event.data && event.data.type === 'navigate') {
              const pageName = event.data.page.split('/').pop();
              if (files && files.some(f => f.name === pageName)) {
                  setActivePreviewPage(pageName);
              } else {
                  console.warn(`Navigation to "${pageName}" was requested, but the file was not found.`);
              }
          }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
  }, [files]);


  useEffect(() => {
    if (!files.some(f => f.name === selectedFile)) {
      setSelectedFile(files.find(f => f.name === 'index.html')?.name || files[0]?.name || '');
    }
     if (!files.some(f => f.name === activePreviewPage)) {
      setActivePreviewPage('index.html');
    }
  }, [files, selectedFile, activePreviewPage]);

  const currentFileContent = files.find(f => f.name === selectedFile)?.content || '';
  
  const handleFileContentChange = (newContent: string) => {
      const updatedFiles = files.map(file => 
          file.name === selectedFile ? { ...file, content: newContent } : file
      );
      onFileContentChange(updatedFiles);
  };


  useEffect(() => {
    const formatCode = () => {
        if (typeof currentFileContent !== 'string' || !window.prettier || !window.prettierPlugins || !window.prettierPlugins.html || !window.prettierPlugins.babel || !window.prettierPlugins.postcss) {
            setFormattedContent(currentFileContent);
            setLineCount(currentFileContent ? currentFileContent.split('\n').length : 0);
            return;
        }

        const getParser = (fileName: string) => {
            if (fileName.endsWith('.html')) return 'html';
            if (fileName.endsWith('.css')) return 'css';
            if (fileName.endsWith('.js') || fileName.endsWith('.jsx') || fileName.endsWith('.ts') || fileName.endsWith('.tsx')) return 'babel';
            return 'babel';
        };

        try {
            const parser = getParser(selectedFile);
            const plugins = [
                window.prettierPlugins.html,
                window.prettierPlugins.babel,
                window.prettierPlugins.postcss,
            ];

            const formatted = window.prettier.format(currentFileContent, {
                parser: parser,
                plugins: plugins,
            });
            setFormattedContent(formatted);
            setLineCount(formatted.split('\n').length);
        } catch (error) {
            console.error("Could not format code:", error);
            setFormattedContent(currentFileContent);
            setLineCount(currentFileContent.split('\n').length);
        }
    };
    formatCode();
  }, [currentFileContent, selectedFile]);

  const handleScroll = () => {
    if (lineNumbersRef.current && textAreaRef.current) {
        lineNumbersRef.current.scrollTop = textAreaRef.current.scrollTop;
    }
  };

  const getPreviewContent = useCallback(() => {
    if (!files || files.length === 0) return '';
    
    const pageFile = files.find(f => f.name === activePreviewPage);
    if (!pageFile || !pageFile.name.endsWith('.html')) return `<!-- Preview Error: Could not find HTML file "${activePreviewPage}" -->`;

    let htmlContent = pageFile.content;

    // Inject styles
    const linkRegex = /<link\s+.*?href="([^"]+\.css)"[^>]*>/g;
    htmlContent = htmlContent.replace(linkRegex, (match, href) => {
        const cssFile = files.find(f => f.name === href);
        return cssFile ? `<style>\n${cssFile.content}\n</style>` : match;
    });
    
    // Inject scripts and virtual navigation
    const scriptRegex = /<script\s+.*?src="([^"]+\.js)"[^>]*><\/script>/g;
    htmlContent = htmlContent.replace(scriptRegex, (match, src) => {
        const jsFile = files.find(f => f.name === src);
        return jsFile ? `<script>\n${jsFile.content}\n</script>` : match;
    });

    const allFilesForNav = JSON.stringify(files.filter(f => f.name.endsWith('.html')).map(f => ({ name: f.name, content: f.content })));

    const navigationScript = `
      <script>
        const allPages = ${allFilesForNav};
        document.addEventListener('DOMContentLoaded', () => {
          // Virtual navigation for standard links
          document.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', (event) => {
              const href = link.getAttribute('href');
              const targetPage = allPages.find(p => p.name === href);
              if (href && !href.startsWith('http') && !href.startsWith('#') && targetPage) {
                event.preventDefault();
                document.body.innerHTML = new DOMParser().parseFromString(targetPage.content, 'text/html').body.innerHTML;
                
                // Re-run scripts from the new body
                const newScripts = document.body.querySelectorAll('script');
                newScripts.forEach(oldScript => {
                  const newScript = document.createElement('script');
                  Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
                  newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                  oldScript.parentNode.replaceChild(newScript, oldScript);
                });

                // Re-attach listeners for the new DOM
                window.parent.postMessage({ type: 'virtual-nav-reinit' }, '*');
              }
            });
          });
        });

        // Listener to re-initialize after a virtual nav
         window.addEventListener('message', (event) => {
          if(event.data && event.data.type === 'virtual-nav-reinit') {
            // This is a bit of a trick to re-run the DOMContentLoaded logic
            const fakeEvent = new Event('DOMContentLoaded');
            document.dispatchEvent(fakeEvent);
          }
        });
      </script>
    `;
    return htmlContent.replace('</body>', `${navigationScript}</body>`);
  }, [files, activePreviewPage]);


  const handleCopyCode = useCallback(() => {
    if (formattedContent) {
      navigator.clipboard.writeText(formattedContent).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      });
    }
  }, [formattedContent]);
  
  const handleDownloadZip = useCallback(() => {
    const zip = new JSZip();
    files.forEach(file => {
      zip.file(file.name, file.content);
    });

    zip.generateAsync({ type: "blob" }).then((content) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = "webapp.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }, [files]);

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col p-4">
        <div className="flex justify-end mb-2">
          <button 
            onClick={() => setIsFullscreen(false)} 
            className="p-2 rounded-full bg-slate-700 hover:bg-slate-600 text-white"
            aria-label="Exit fullscreen"
          >
            <ArrowsPointingInIcon className="h-6 w-6" />
          </button>
        </div>
        <div className="flex-grow bg-white rounded-lg overflow-hidden">
          <iframe
            srcDoc={getPreviewContent()}
            title="Generated App Preview Fullscreen"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-modals allow-same-origin"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-slate-800/70 border border-slate-700/50 rounded-xl flex flex-col overflow-hidden">
      {isRefining && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
            <LoadingSpinnerIcon />
            <p className="mt-4 text-slate-300">Updating code...</p>
        </div>
      )}
      <div className="flex justify-between items-center border-b border-slate-700 p-2">
        <div className="flex space-x-2">
          <button onClick={() => setActiveTab('preview')} className={`px-4 py-2 text-sm font-medium rounded-md flex items-center ${activeTab === 'preview' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-slate-700'}`}>
            <CubeIcon className="h-5 w-5 mr-2" /> Preview
          </button>
          <button onClick={() => setActiveTab('code')} className={`px-4 py-2 text-sm font-medium rounded-md flex items-center ${activeTab === 'code' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-slate-700'}`}>
            <CodeBracketIcon className="h-5 w-5 mr-2" /> Code
          </button>
        </div>
        <div className="flex items-center space-x-2">
          {activeTab === 'preview' && (
            <button onClick={() => setIsFullscreen(true)} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="Fullscreen Preview">
              <ArrowsPointingOutIcon className="h-5 w-5" />
            </button>
          )}
          {activeTab === 'code' && (
            <>
              <button onClick={handleCopyCode} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label={isCopied ? 'Copied!' : 'Copy code'}>
                {isCopied ? <CheckIcon className="h-5 w-5 text-green-400" /> : <ClipboardIcon className="h-5 w-5" />}
              </button>
              <button onClick={() => setIsGithubModalOpen(true)} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="Push to GitHub">
                <GitHubIcon className="h-5 w-5" />
              </button>
              <button onClick={handleDownloadZip} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="Download ZIP">
                <ArchiveBoxIcon className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      </div>
      {activeTab === 'preview' ? (
        <div className="flex-grow p-1 bg-slate-800/70 rounded-b-xl overflow-hidden">
          <iframe
            srcDoc={getPreviewContent()}
            title="Generated App Preview"
            className="w-full h-full border-0 bg-white rounded-lg"
            sandbox="allow-scripts allow-modals allow-same-origin"
          />
        </div>
      ) : (
        <div className="flex flex-row flex-grow bg-slate-900 rounded-b-xl overflow-hidden font-mono text-sm">
          <div className="w-48 bg-slate-800/50 border-r border-slate-700 p-2 overflow-y-auto">
            <p className="text-xs text-gray-400 font-semibold mb-2 px-2">FILES</p>
            {files.map(file => (
              <button
                key={file.name}
                onClick={() => setSelectedFile(file.name)}
                className={`w-full text-left flex items-center px-2 py-1.5 text-sm rounded-md ${selectedFile === file.name ? 'bg-purple-600/30 text-purple-200' : 'text-gray-300 hover:bg-slate-700'}`}
              >
                <DocumentIcon className="h-4 w-4 mr-2 flex-shrink-0" />
                <span className="truncate">{file.name}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-grow overflow-hidden">
            <div
              ref={lineNumbersRef}
              className="w-12 text-right p-4 bg-slate-900 text-gray-500 select-none overflow-y-hidden"
              aria-hidden="true"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={textAreaRef}
              value={formattedContent}
              onChange={(e) => handleFileContentChange(e.target.value)}
              onScroll={handleScroll}
              className="flex-grow h-full p-4 bg-transparent text-gray-200 focus:outline-none resize-none"
              style={{ lineHeight: '1.5rem', caretColor: 'white' }}
              spellCheck="false"
            />
          </div>
        </div>
      )}
      {isGithubModalOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setIsGithubModalOpen(false)}
        >
          <div 
            className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-6 max-w-lg w-full transform transition-all" 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-xl font-semibold text-white flex items-center">
                <GitHubIcon className="h-6 w-6 mr-3" />
                Push to GitHub
              </h3>
               <button 
                onClick={() => setIsGithubModalOpen(false)} 
                className="p-1 rounded-full text-gray-400 hover:bg-slate-700 hover:text-white"
                aria-label="Close modal"
              >
                 <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <p className="mt-4 text-gray-300">
              To get your new web app onto GitHub, follow these simple steps. This app runs in your browser, so it can't create a repository for you automatically.
            </p>
            <ol className="list-decimal list-inside mt-4 space-y-3 text-gray-300">
              <li>
                <span className="font-semibold text-white">Download the code:</span> Use the <ArchiveBoxIcon className="h-4 w-4 inline-block mx-1" /> icon to download your project as a .zip file and unzip it.
              </li>
              <li>
                <span className="font-semibold text-white">Create a new repository:</span> Go to GitHub and <a href="https://github.com/new" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">create a new repository</a>.
              </li>
              <li>
                <span className="font-semibold text-white">Upload your files:</span> Follow the "…or create a new repository on the command line" or "…or push an existing repository from the command line" instructions on your new GitHub repository page to upload your code.
              </li>
            </ol>
            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => setIsGithubModalOpen(false)} 
                className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const [initialPrompt, setInitialPrompt] = useState<string>('');
  const [appFiles, setAppFiles] = useState<WebFile[] | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [refinementPrompt, setRefinementPrompt] = useState<string>('');
  const [refinementHistory, setRefinementHistory] = useState<RefinementChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [refinementHistory]);
  
  const handleGenerate = useCallback(async (promptText: string) => {
    if (!promptText.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setAppFiles(null);
    setRefinementHistory([]);

    try {
      const newCode = await generateWebAppCode(promptText);
      setAppFiles(newCode);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate app. ${errorMessage}`);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating]);
  
  const handleRefine = useCallback(async () => {
    if (!refinementPrompt.trim() || !appFiles || isRefining) return;

    const userMessage: RefinementChatMessage = {
      id: Date.now(),
      role: 'user',
      content: refinementPrompt,
    };
    setRefinementHistory(prev => [...prev, userMessage]);
    setRefinementPrompt('');
    setIsRefining(true);
    setError(null);

    try {
      const refinedResult = await refineWebAppCode(refinementPrompt, appFiles);
      setAppFiles(refinedResult.files);
      const assistantMessage: RefinementChatMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: refinedResult.explanation,
      };
      setRefinementHistory(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to refine app. ${errorMessage}`);
      const assistantErrorMessage: RefinementChatMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `I'm sorry, I encountered an error: ${errorMessage}`
      };
      setRefinementHistory(prev => [...prev, assistantErrorMessage]);
    } finally {
      setIsRefining(false);
    }
  }, [appFiles, isRefining, refinementPrompt]);

  const handleSuggestionClick = (suggestionPrompt: string) => {
      setInitialPrompt(suggestionPrompt);
      handleGenerate(suggestionPrompt);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, handler: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handler();
    }
  };

  if (!appFiles && !isGenerating && !error) {
    return (
      <div className="min-h-screen bg-slate-900 text-gray-300 flex flex-col font-sans">
        <header className="bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
          <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <AikacungwenLogoIcon className="h-8 w-8 text-white" />
              <h1 className="text-xl font-semibold text-white">Aikacungwen</h1>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-sm font-medium rounded-md flex items-center bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white">
                <ShareIcon className="h-5 w-5 mr-2" />
                Share
              </button>
              <a href="https://github.com/aistudio-co/aikacungwen" target="_blank" rel="noopener noreferrer" className="p-2 text-gray-400 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="View on GitHub">
                <GitHubIcon className="h-6 w-6" />
              </a>
            </div>
          </div>
        </header>
        <main className="flex-grow w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col pt-6 pb-24">
            <div className="m-auto flex flex-col items-center justify-center text-center">
                <AikacungwenLogoIcon className="h-16 w-16 text-slate-500" />
                <h2 className="mt-4 text-2xl font-semibold text-slate-300">How can I help you today?</h2>
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
                    {suggestionPrompts.map((s, i) => (
                        <button
                            key={i}
                            onClick={() => handleSuggestionClick(s.prompt)}
                            className="group flex items-center gap-4 p-4 bg-slate-800/80 border border-slate-700 rounded-lg text-left hover:bg-slate-700/60 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <div className="flex-shrink-0 p-3 bg-slate-900 rounded-full border border-slate-700 group-hover:border-purple-500 transition-colors duration-200">
                                {s.icon}
                            </div>
                            <div>
                                <p className="font-semibold text-slate-300">{s.title}</p>
                                <p className="text-sm text-slate-400">{s.prompt}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </main>
         <footer className="fixed bottom-0 left-0 right-0 bg-slate-900/80 backdrop-blur-md">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="relative">
                <textarea
                  value={initialPrompt}
                  onChange={(e) => setInitialPrompt(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, () => handleGenerate(initialPrompt))}
                  placeholder="Describe the web app you want to create..."
                  className="w-full p-4 pr-16 bg-slate-800 border border-slate-700 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none text-gray-200 placeholder-gray-500"
                  rows={1}
                />
                <button
                  onClick={() => handleGenerate(initialPrompt)}
                  disabled={isGenerating || !initialPrompt.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1.2 p-3 bg-purple-600 text-white rounded-full hover:bg-purple-700 disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
                  aria-label="Generate"
                >
                  <PaperAirplaneIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-gray-300 flex flex-col font-sans">
       <header className="bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <AikacungwenLogoIcon className="h-8 w-8 text-white" />
              <h1 className="text-xl font-semibold text-white">Aikacungwen</h1>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-sm font-medium rounded-md flex items-center bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white">
                <ShareIcon className="h-5 w-5 mr-2" />
                Share
              </button>
              <a href="https://github.com/aistudio-co/aikacungwen" target="_blank" rel="noopener noreferrer" className="p-2 text-gray-400 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="View on GitHub">
                <GitHubIcon className="h-6 w-6" />
              </a>
            </div>
          </div>
        </header>

        <main className="flex-grow w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 md:h-[calc(100vh-64px)]">
            {/* Left Column: Refinement Chat */}
            <div className="flex flex-col h-full">
                <h2 className="text-lg font-semibold text-slate-200 mb-4">Chat Assistant</h2>
                <div className="flex-grow bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 overflow-y-auto space-y-6">
                    {refinementHistory.map((message) => (
                       <div key={message.id} className={`flex items-start gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
                          {message.role === 'assistant' && (
                             <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center">
                                <AikacungwenLogoIcon className="h-5 w-5 text-white" />
                            </div>
                          )}
                          <div className={`p-3 rounded-lg max-w-md ${message.role === 'user' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-200'}`}>
                             <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          </div>
                           {message.role === 'user' && (
                             <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center">
                                <UserIcon className="h-5 w-5 text-white" />
                            </div>
                          )}
                       </div>
                    ))}
                    {error && !isRefining && (
                         <div className="p-3 rounded-lg bg-red-900/50 text-red-300 text-sm">
                            <p className="font-semibold">An error occurred</p>
                            <p className="mt-1">{error}</p>
                         </div>
                    )}
                    <div ref={chatEndRef}></div>
                </div>
                <div className="mt-4 relative">
                    <textarea
                      value={refinementPrompt}
                      onChange={(e) => setRefinementPrompt(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, handleRefine)}
                      placeholder="Update the color, add a section..."
                      className="w-full p-4 pr-16 bg-slate-800 border border-slate-700 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none text-gray-200 placeholder-gray-500"
                      rows={1}
                      disabled={isRefining}
                    />
                    <button
                      onClick={handleRefine}
                      disabled={isRefining || !refinementPrompt.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-purple-600 text-white rounded-full hover:bg-purple-700 disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
                      aria-label="Refine"
                    >
                      {isRefining ? <LoadingSpinnerIcon /> : <PaperAirplaneIcon className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {/* Right Column: Result */}
            <div className="h-full">
              {(isGenerating || !appFiles) ? (
                 <div className="w-full h-full bg-slate-800/70 border border-slate-700/50 rounded-xl flex flex-col items-center justify-center">
                    <LoadingSpinnerIcon />
                    <p className="mt-4 text-slate-300">{isGenerating ? 'Generating your new app...' : 'Awaiting generation...'}</p>
                 </div>
              ) : (
                <CodeResult 
                    files={appFiles} 
                    onFileContentChange={setAppFiles}
                    isRefining={isRefining}
                />
              )}
            </div>
        </main>
    </div>
  );
};

export default App;