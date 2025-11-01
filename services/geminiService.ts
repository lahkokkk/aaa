import { GoogleGenAI, Type } from "@google/genai";

export type WebFile = {
    name: string;
    content: string;
};

export type RefinementResult = {
    files: WebFile[];
    explanation: string;
};

// Lazily initialize the AI instance to avoid crashing on load if API_KEY is not set.
let ai: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
    if (ai) {
        return ai;
    }
    // Check for the API key at the time of use, not at script load.
    if (!process.env.API_KEY) {
        // This error will be caught by the calling function's try/catch block.
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
        // A simple validation, more robust validation can be added
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
4.  **Navigasi Virtual:** Ingatlah bahwa lingkungan pratinjau menggunakan sistem navigasi virtual. Tautan antar halaman (mis. \`<a href="portfolio.html">\`) akan berfungsi secara otomatis.
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