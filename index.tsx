import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import JSZip from 'jszip';
import { GoogleGenAI, Type } from "@google/genai";

// --- START OF COMBINED CODE ---

// --- SERVICES ---
export type WebFile = {
    name: string;
    content: string;
};

export type RefinementResult = {
    files: WebFile[];
    explanation: string;
};

let ai: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
    if (ai) {
        return ai;
    }
    if (!process.env.API_KEY) {
        throw new Error("Kunci API Gemini tidak dikonfigurasi. Harap atur di lingkungan deployment Anda (misalnya, Variabel Lingkungan di Cloudflare Pages).");
    }
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return ai;
}

const generationResponseSchema = {
    type: Type.OBJECT,
    properties: {
        files: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    content: { type: Type.STRING },
                },
                required: ["name", "content"],
            },
        },
    },
    required: ["files"],
};

const refinementResponseSchema = {
    type: Type.OBJECT,
    properties: {
        files: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    content: { type: Type.STRING },
                },
                required: ["name", "content"],
            },
        },
        explanation: {
            type: Type.STRING,
            description: "A brief, user-friendly explanation of the changes made, written in Indonesian."
        },
    },
    required: ["files", "explanation"],
};

function parseJsonResponse(rawText: string, schema: any): any {
    try {
        const parsed = JSON.parse(rawText);
        if (schema.required.every((key: string) => key in parsed)) {
             return parsed;
        }
        throw new Error("Invalid response format: Missing required keys.");
    } catch (e) {
        console.error("Failed to parse JSON response:", e);
        console.error("Raw response text:", rawText);
        
        const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            try {
                const parsedFromJsonMarkdown = JSON.parse(jsonMatch[1]);
                if (schema.required.every((key: string) => key in parsedFromJsonMarkdown)) {
                    return parsedFromJsonMarkdown;
                }
            } catch (jsonError) {
                 console.error("Failed to parse extracted JSON from markdown:", jsonError);
            }
        }
        throw new Error("Could not parse a valid object from the model's response.");
    }
}

export async function generateWebAppCode(description: string): Promise<WebFile[]> {
  try {
    const genAI = getGenAI();
    const prompt = `You are an expert web developer. Your task is to create a web application based on the user's request.
You must decide which files are necessary and generate them. For a standard web app, this usually includes 'index.html', 'style.css', and 'script.js'. For more complex requests, you may create additional files (e.g., 'about.html', 'portfolio.html').
**\`index.html\` (and other HTML files) Requirements:**
- Must be a complete HTML5 document.
- Must correctly link to any CSS and JavaScript files you create.
**CSS file Requirements:**
- Contains all CSS rules.
- Should follow modern design principles.
- Must be responsive and adapt to different screen sizes. Avoid fixed widths that cause horizontal overflow. Content should wrap gracefully.
**JavaScript file Requirements:**
- Contains all JavaScript logic.
- Must use vanilla JavaScript only. Do NOT use any external frameworks or libraries.
- **Navigation Note:** All links between HTML pages (e.g., <a href="about.html">) are handled by a virtual navigation system in the preview environment. Use standard relative links, and they will work automatically.
**Output Format:**
Your response must be a single JSON object that strictly adheres to this schema: { "files": [ { "name": "file_name.ext", "content": "file_content_as_string" } ] }.
Do not include any markdown fences or other text outside of the JSON object.
---
User's Request: "${description}"
`;
    const result = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ parts: [{ text: prompt }] }],
        config: {
            temperature: 0.1,
            topP: 0.95,
            topK: 64,
            maxOutputTokens: 16384,
            responseMimeType: "application/json",
            responseSchema: generationResponseSchema,
        }
    });
    const rawText = result.text.trim();
    const parsed = parseJsonResponse(rawText, generationResponseSchema);
    return parsed.files;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
        throw error;
    }
    throw new Error("Failed to communicate with the Gemini API.");
  }
}

export async function refineWebAppCode(instruction: string, currentFiles: WebFile[]): Promise<RefinementResult> {
    try {
        const genAI = getGenAI();
        const currentCodeString = currentFiles.map(file => `\`\`\`${file.name}\n${file.content}\n\`\`\``).join('\n\n');

        const prompt = `Anda adalah asisten pengembang web AI yang ahli. Tugas Anda adalah memodifikasi aplikasi web yang ada berdasarkan permintaan pengguna dan menjelaskan perubahan yang Anda buat.
Berikut adalah kode saat ini untuk semua file dalam proyek:
${currentCodeString}
Sekarang, terapkan permintaan perubahan berikut dari pengguna: "${instruction}"
**PERSYARATAN TANGGAPAN:**
1.  **Modifikasi kode:** Perbarui file yang diperlukan untuk memenuhi permintaan pengguna. Anda harus mampu menangani permintaan kompleks seperti menambahkan fungsionalitas JavaScript baru, membuat elemen HTML baru, atau bahkan **membuat file HTML baru** (misalnya, 'portfolio.html') jika diminta.
2.  **Jelaskan perubahan Anda:** Tulis penjelasan singkat dan ramah pengguna tentang apa yang Anda lakukan.
3.  **Kembalikan SEMUA file:** Respons Anda harus menyertakan kode lengkap yang telah diperbarui untuk SEMUA file, bahkan file yang tidak diubah.
4.  **Navigasi Virtual:** Ingatlah bahwa lingkungan pratinau menggunakan sistem navigasi virtual. Tautan antar halaman (mis. \`<a href="portfolio.html">\`) akan berfungsi secara otomatis.
5.  **Patuhi skema:** Respons Anda harus berupa satu objek JSON yang secara ketat mematuhi skema ini: { "files": [ { "name": "file_name.ext", "content": "file_content_as_string" } ], "explanation": "Ringkasan perubahan Anda." }.
6.  **Tanpa teks tambahan:** Jangan sertakan markdown atau teks lain di luar objek JSON tunggal ini.
7.  **SANGAT PENTING: Penjelasan Anda HARUS dalam Bahasa Indonesia.** Jangan gunakan bahasa Inggris.
`;
        const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                temperature: 0.1,
                topP: 0.95,
                topK: 64,
                maxOutputTokens: 16384,
                responseMimeType: "application/json",
                responseSchema: refinementResponseSchema,
            }
        });
        const rawText = result.text.trim();
        return parseJsonResponse(rawText, refinementResponseSchema);
    } catch (error) {
        console.error("Error calling Gemini API for refinement:", error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Failed to communicate with the Gemini API for refinement.");
    }
}


// --- ICONS ---
const LoadingSpinnerIcon: React.FC = () => (
  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);
const CubeIcon: React.FC<{className?: string}> = ({className = "h-8 w-8 text-blue-400"}) => (<svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>);
const CodeBracketIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>);
const ClipboardIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a2.25 2.25 0 01-2.25 2.25H9A2.25 2.25 0 016.75 5.25v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V7.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>);
const ArchiveBoxIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.03 1.126 0 1.131.094 1.976 1.057 1.976 2.192V7.5M8.25 7.5h7.5m-7.5 0-1 9.75L8.25 21h7.5l.9-3.75 1-9.75m-9.5 0-1.5-1.5"/></svg>);
const ArrowsPointingOutIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m4.5 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>);
const ArrowsPointingInIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" /></svg>);
const CheckIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>);
const DocumentIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>);
const GitHubIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={className}><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>);
const XMarkIcon: React.FC<{className?: string}> = ({className = "h-6 w-6"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>);
const ShareIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>);
const AikacungwenLogoIcon: React.FC<{className?: string}> = ({className = "h-8 w-8 text-white"}) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M21.71,6.7,13.29.29A2,2,0,0,0,12,0a2,2,0,0,0-1.29.29L2.29,6.7a2,2,0,0,0-1,1.72V15.58a2,2,0,0,0,1,1.72l8.42,6.41a2,2,0,0,0,1.29.29,2,2,0,0,0,1.29-.29l8.42-6.41a2,2,0,0,0,1-1.72V8.42A2,2,0,0,0,21.71,6.7Zm-9.13,13.2L5.87,15.1,12,11.23l6.13,3.87ZM12,9.33,5.87,5.46l6.13-3.87,6.13,3.87Z" style={{fillRule:'nonzero'}}/></svg>);
const UserIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>);
const PaperAirplaneIcon: React.FC<{className?: string}> = ({className = "h-5 w-5"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>);
const IdeaIcon: React.FC<{className?: string}> = ({className = "h-6 w-6"}) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.311a15.045 15.045 0 01-4.5 0M12 3v2.25m0 0a6.01 6.01 0 001.5.189m-1.5-.189a6.01 6.01 0 01-1.5-.189M12 12a6 6 0 016 6m-6-6a6 6 0 00-6 6" /></svg>);

// --- APP COMPONENT ---
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
  { icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>, title: 'Create a portfolio', prompt: 'A portfolio website for a professional photographer.' },
  { icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>, title: 'Build a landing page', prompt: 'A modern landing page for a new SaaS application.' },
  { icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>, title: 'Make a to-do list app', prompt: 'A simple to-do list application to manage tasks.' },
  { icon: <IdeaIcon className="h-6 w-6 text-slate-400"/>, title: 'Design a personal blog', prompt: 'A clean and minimal personal blog layout.' },
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
    if (!files.some(f => f.name === selectedFile)) { setSelectedFile(files.find(f => f.name === 'index.html')?.name || files[0]?.name || ''); }
    if (!files.some(f => f.name === activePreviewPage)) { setActivePreviewPage('index.html'); }
  }, [files, selectedFile, activePreviewPage]);

  const currentFileContent = files.find(f => f.name === selectedFile)?.content || '';
  
  const handleFileContentChange = (newContent: string) => {
      const updatedFiles = files.map(file => file.name === selectedFile ? { ...file, content: newContent } : file);
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
            if (fileName.endsWith('.js')) return 'babel';
            return 'babel';
        };
        try {
            const parser = getParser(selectedFile);
            const plugins = [ window.prettierPlugins.html, window.prettierPlugins.babel, window.prettierPlugins.postcss ];
            const formatted = window.prettier.format(currentFileContent, { parser: parser, plugins: plugins });
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
    if (lineNumbersRef.current && textAreaRef.current) { lineNumbersRef.current.scrollTop = textAreaRef.current.scrollTop; }
  };

  const getPreviewContent = useCallback(() => {
    if (!files || files.length === 0) return '';
    const pageFile = files.find(f => f.name === activePreviewPage);
    if (!pageFile || !pageFile.name.endsWith('.html')) return `<!-- Preview Error: Could not find HTML file "${activePreviewPage}" -->`;
    let htmlContent = pageFile.content;
    const linkRegex = /<link\s+.*?href="([^"]+\.css)"[^>]*>/g;
    htmlContent = htmlContent.replace(linkRegex, (match, href) => {
        const cssFile = files.find(f => f.name === href);
        return cssFile ? `<style>\n${cssFile.content}\n</style>` : match;
    });
    const scriptRegex = /<script\s+.*?src="([^"]+\.js)"[^>]*><\/script>/g;
    htmlContent = htmlContent.replace(scriptRegex, (match, src) => {
        const jsFile = files.find(f => f.name === src);
        return jsFile ? `<script>\n${jsFile.content}\n</script>` : match;
    });
    const allFilesForNav = JSON.stringify(files.filter(f => f.name.endsWith('.html')).map(f => ({ name: f.name, content: f.content })));
    const navigationScript = `<script>const allPages = ${allFilesForNav}; document.addEventListener('DOMContentLoaded', () => { document.querySelectorAll('a').forEach(link => { link.addEventListener('click', (event) => { const href = link.getAttribute('href'); const targetPage = allPages.find(p => p.name === href); if (href && !href.startsWith('http') && !href.startsWith('#') && targetPage) { event.preventDefault(); document.body.innerHTML = new DOMParser().parseFromString(targetPage.content, 'text/html').body.innerHTML; const newScripts = document.body.querySelectorAll('script'); newScripts.forEach(oldScript => { const newScript = document.createElement('script'); Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value)); newScript.appendChild(document.createTextNode(oldScript.innerHTML)); oldScript.parentNode.replaceChild(newScript, oldScript); }); window.parent.postMessage({ type: 'virtual-nav-reinit' }, '*'); } }); }); }); window.addEventListener('message', (event) => { if(event.data && event.data.type === 'virtual-nav-reinit') { const fakeEvent = new Event('DOMContentLoaded'); document.dispatchEvent(fakeEvent); } }); </script>`;
    return htmlContent.replace('</body>', `${navigationScript}</body>`);
  }, [files, activePreviewPage]);

  const handleCopyCode = useCallback(() => {
    if (formattedContent) { navigator.clipboard.writeText(formattedContent).then(() => { setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }); }
  }, [formattedContent]);
  
  const handleDownloadZip = useCallback(() => {
    const zip = new JSZip();
    files.forEach(file => { zip.file(file.name, file.content); });
    zip.generateAsync({ type: "blob" }).then((content) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = "webapp.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }, [files]);

  if (isFullscreen) { return ( <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col p-4"> <div className="flex justify-end mb-2"> <button onClick={() => setIsFullscreen(false)} className="p-2 rounded-full bg-slate-700 hover:bg-slate-600 text-white" aria-label="Exit fullscreen"> <ArrowsPointingInIcon className="h-6 w-6" /> </button> </div> <div className="flex-grow bg-white rounded-lg overflow-hidden"> <iframe srcDoc={getPreviewContent()} title="Generated App Preview Fullscreen" className="w-full h-full border-0" sandbox="allow-scripts allow-modals allow-same-origin" /> </div> </div> ); }

  return (
    <div className="relative w-full h-full bg-slate-800/70 border border-slate-700/50 rounded-xl flex flex-col overflow-hidden">
      {isRefining && ( <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center"> <LoadingSpinnerIcon /> <p className="mt-4 text-slate-300">Updating code...</p> </div> )}
      <div className="flex justify-between items-center border-b border-slate-700 p-2">
        <div className="flex space-x-2">
          <button onClick={() => setActiveTab('preview')} className={`px-4 py-2 text-sm font-medium rounded-md flex items-center ${activeTab === 'preview' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-slate-700'}`}> <CubeIcon className="h-5 w-5 mr-2" /> Preview </button>
          <button onClick={() => setActiveTab('code')} className={`px-4 py-2 text-sm font-medium rounded-md flex items-center ${activeTab === 'code' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-slate-700'}`}> <CodeBracketIcon className="h-5 w-5 mr-2" /> Code </button>
        </div>
        <div className="flex items-center space-x-2">
          {activeTab === 'preview' && ( <button onClick={() => setIsFullscreen(true)} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="Fullscreen Preview"> <ArrowsPointingOutIcon className="h-5 w-5" /> </button> )}
          {activeTab === 'code' && ( <> <button onClick={handleCopyCode} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label={isCopied ? 'Copied!' : 'Copy code'}> {isCopied ? <CheckIcon className="h-5 w-5 text-green-400" /> : <ClipboardIcon className="h-5 w-5" />} </button> <button onClick={() => setIsGithubModalOpen(true)} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="Push to GitHub"> <GitHubIcon className="h-5 w-5" /> </button> <button onClick={handleDownloadZip} className="p-2 text-gray-300 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="Download ZIP"> <ArchiveBoxIcon className="h-5 w-5" /> </button> </> )}
        </div>
      </div>
      {activeTab === 'preview' ? ( <div className="flex-grow p-1 bg-slate-800/70 rounded-b-xl overflow-hidden"> <iframe srcDoc={getPreviewContent()} title="Generated App Preview" className="w-full h-full border-0 bg-white rounded-lg" sandbox="allow-scripts allow-modals allow-same-origin" /> </div> ) : (
        <div className="flex flex-row flex-grow bg-slate-900 rounded-b-xl overflow-hidden font-mono text-sm">
          <div className="w-48 bg-slate-800/50 border-r border-slate-700 p-2 overflow-y-auto">
            <p className="text-xs text-gray-400 font-semibold mb-2 px-2">FILES</p>
            {files.map(file => ( <button key={file.name} onClick={() => setSelectedFile(file.name)} className={`w-full text-left flex items-center px-2 py-1.5 text-sm rounded-md ${selectedFile === file.name ? 'bg-purple-600/30 text-purple-200' : 'text-gray-300 hover:bg-slate-700'}`}> <DocumentIcon className="h-4 w-4 mr-2 flex-shrink-0" /> <span className="truncate">{file.name}</span> </button> ))}
          </div>
          <div className="flex flex-grow overflow-hidden">
            <div ref={lineNumbersRef} className="w-12 text-right p-4 bg-slate-900 text-gray-500 select-none overflow-y-hidden" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => ( <div key={i}>{i + 1}</div> ))}
            </div>
            <textarea ref={textAreaRef} value={formattedContent} onChange={(e) => handleFileContentChange(e.target.value)} onScroll={handleScroll} className="flex-grow h-full p-4 bg-transparent text-gray-200 focus:outline-none resize-none" style={{ lineHeight: '1.5rem', caretColor: 'white' }} spellCheck="false" />
          </div>
        </div>
      )}
      {isGithubModalOpen && ( <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsGithubModalOpen(false)}> <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-6 max-w-lg w-full transform transition-all" onClick={e => e.stopPropagation()}> <div className="flex items-start justify-between"> <h3 className="text-xl font-semibold text-white flex items-center"> <GitHubIcon className="h-6 w-6 mr-3" /> Push to GitHub </h3> <button onClick={() => setIsGithubModalOpen(false)} className="p-1 rounded-full text-gray-400 hover:bg-slate-700 hover:text-white" aria-label="Close modal"> <XMarkIcon className="h-6 w-6" /> </button> </div> <p className="mt-4 text-gray-300"> To get your new web app onto GitHub, follow these simple steps. This app runs in your browser, so it can't create a repository for you automatically. </p> <ol className="list-decimal list-inside mt-4 space-y-3 text-gray-300"> <li> <span className="font-semibold text-white">Download the code:</span> Use the <ArchiveBoxIcon className="h-4 w-4 inline-block mx-1" /> icon to download your project as a .zip file and unzip it. </li> <li> <span className="font-semibold text-white">Create a new repository:</span> Go to GitHub and <a href="https://github.com/new" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">create a new repository</a>. </li> <li> <span className="font-semibold text-white">Upload your files:</span> Follow the "…or create a new repository on the command line" or "…or push an existing repository from the command line" instructions on your new GitHub repository page to upload your code. </li> </ol> <div className="mt-6 flex justify-end"> <button onClick={() => setIsGithubModalOpen(false)} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700 transition-colors"> Got it </button> </div> </div> </div> )}
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

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [refinementHistory]);
  
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
    const userMessage: RefinementChatMessage = { id: Date.now(), role: 'user', content: refinementPrompt };
    setRefinementHistory(prev => [...prev, userMessage]);
    setRefinementPrompt('');
    setIsRefining(true);
    setError(null);
    try {
      const refinedResult = await refineWebAppCode(refinementPrompt, appFiles);
      setAppFiles(refinedResult.files);
      const assistantMessage: RefinementChatMessage = { id: Date.now() + 1, role: 'assistant', content: refinedResult.explanation };
      setRefinementHistory(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to refine app. ${errorMessage}`);
      const assistantErrorMessage: RefinementChatMessage = { id: Date.now() + 1, role: 'assistant', content: `I'm sorry, I encountered an error: ${errorMessage}` };
      setRefinementHistory(prev => [...prev, assistantErrorMessage]);
    } finally {
      setIsRefining(false);
    }
  }, [appFiles, isRefining, refinementPrompt]);

  const handleSuggestionClick = (suggestionPrompt: string) => { setInitialPrompt(suggestionPrompt); handleGenerate(suggestionPrompt); };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, handler: () => void) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handler(); } };

  if (!appFiles && !isGenerating && !error) {
    return (
      <div className="min-h-screen bg-slate-900 text-gray-300 flex flex-col font-sans">
        <header className="bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
          <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
            <div className="flex items-center gap-3"> <AikacungwenLogoIcon className="h-8 w-8 text-white" /> <h1 className="text-xl font-semibold text-white">Aikacungwen</h1> </div>
            <div className="flex items-center gap-3"> <button className="px-4 py-2 text-sm font-medium rounded-md flex items-center bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white"> <ShareIcon className="h-5 w-5 mr-2" /> Share </button> <a href="https://github.com/aistudio-co/aikacungwen" target="_blank" rel="noopener noreferrer" className="p-2 text-gray-400 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="View on GitHub"> <GitHubIcon className="h-6 w-6" /> </a> </div>
          </div>
        </header>
        <main className="flex-grow w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col pt-6 pb-24">
            <div className="m-auto flex flex-col items-center justify-center text-center">
                <AikacungwenLogoIcon className="h-16 w-16 text-slate-500" />
                <h2 className="mt-4 text-2xl font-semibold text-slate-300">How can I help you today?</h2>
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
                    {suggestionPrompts.map((s, i) => ( <button key={i} onClick={() => handleSuggestionClick(s.prompt)} className="group flex items-center gap-4 p-4 bg-slate-800/80 border border-slate-700 rounded-lg text-left hover:bg-slate-700/60 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500"> <div className="flex-shrink-0 p-3 bg-slate-900 rounded-full border border-slate-700 group-hover:border-purple-500 transition-colors duration-200"> {s.icon} </div> <div> <p className="font-semibold text-slate-300">{s.title}</p> <p className="text-sm text-slate-400">{s.prompt}</p> </div> </button> ))}
                </div>
            </div>
        </main>
         <footer className="fixed bottom-0 left-0 right-0 bg-slate-900/80 backdrop-blur-md">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="relative">
                <textarea value={initialPrompt} onChange={(e) => setInitialPrompt(e.target.value)} onKeyDown={(e) => handleKeyDown(e, () => handleGenerate(initialPrompt))} placeholder="Describe the web app you want to create..." className="w-full p-4 pr-16 bg-slate-800 border border-slate-700 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none text-gray-200 placeholder-gray-500" rows={1} />
                <button onClick={() => handleGenerate(initialPrompt)} disabled={isGenerating || !initialPrompt.trim()} className="absolute right-2 top-1/2 -translate-y-1.2 p-3 bg-purple-600 text-white rounded-full hover:bg-purple-700 disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors" aria-label="Generate"> <PaperAirplaneIcon className="h-5 w-5" /> </button>
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
            <div className="flex items-center gap-3"> <AikacungwenLogoIcon className="h-8 w-8 text-white" /> <h1 className="text-xl font-semibold text-white">Aikacungwen</h1> </div>
            <div className="flex items-center gap-3"> <button className="px-4 py-2 text-sm font-medium rounded-md flex items-center bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white"> <ShareIcon className="h-5 w-5 mr-2" /> Share </button> <a href="https://github.com/aistudio-co/aikacungwen" target="_blank" rel="noopener noreferrer" className="p-2 text-gray-400 rounded-md hover:bg-slate-700 hover:text-white transition-colors" aria-label="View on GitHub"> <GitHubIcon className="h-6 w-6" /> </a> </div>
          </div>
        </header>
        <main className="flex-grow w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 md:h-[calc(100vh-64px)]">
            <div className="flex flex-col h-full">
                <h2 className="text-lg font-semibold text-slate-200 mb-4">Chat Assistant</h2>
                <div className="flex-grow bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 overflow-y-auto space-y-6">
                    {refinementHistory.map((message) => ( <div key={message.id} className={`flex items-start gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}> {message.role === 'assistant' && ( <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center"> <AikacungwenLogoIcon className="h-5 w-5 text-white" /> </div> )} <div className={`p-3 rounded-lg max-w-md ${message.role === 'user' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-200'}`}> <p className="text-sm whitespace-pre-wrap">{message.content}</p> </div> {message.role === 'user' && ( <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center"> <UserIcon className="h-5 w-5 text-white" /> </div> )} </div> ))}
                    {error && !isRefining && ( <div className="p-3 rounded-lg bg-red-900/50 text-red-300 text-sm"> <p className="font-semibold">An error occurred</p> <p className="mt-1">{error}</p> </div> )}
                    <div ref={chatEndRef}></div>
                </div>
                <div className="mt-4 relative">
                    <textarea value={refinementPrompt} onChange={(e) => setRefinementPrompt(e.target.value)} onKeyDown={(e) => handleKeyDown(e, handleRefine)} placeholder="Update the color, add a section..." className="w-full p-4 pr-16 bg-slate-800 border border-slate-700 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none text-gray-200 placeholder-gray-500" rows={1} disabled={isRefining} />
                    <button onClick={handleRefine} disabled={isRefining || !refinementPrompt.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-purple-600 text-white rounded-full hover:bg-purple-700 disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors" aria-label="Refine"> {isRefining ? <LoadingSpinnerIcon /> : <PaperAirplaneIcon className="h-5 w-5" />} </button>
                </div>
            </div>
            <div className="h-full">
              {(isGenerating || !appFiles) ? ( <div className="w-full h-full bg-slate-800/70 border border-slate-700/50 rounded-xl flex flex-col items-center justify-center"> <LoadingSpinnerIcon /> <p className="mt-4 text-slate-300">{isGenerating ? 'Generating your new app...' : 'Awaiting generation...'}</p> </div> ) : ( <CodeResult files={appFiles} onFileContentChange={setAppFiles} isRefining={isRefining} /> )}
            </div>
        </main>
    </div>
  );
};
// FIX: The following block was causing multiple errors due to incorrect file concatenation.
// It contained duplicate imports, invalid syntax, and conflicted with the 'App' component defined above.
// It has been replaced with the correct application entry point logic.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
