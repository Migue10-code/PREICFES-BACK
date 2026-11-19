// Chatbot de estudio PREICFES: recibe el mensaje del front y consulta a Gemini.
// La clave GEMINI_API_KEY vive solo en el .env del back y nunca llega al navegador.

const MODELO = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Modelo opcional de respaldo (GEMINI_MODEL_RESPALDO en el .env) por si el principal está saturado
const MODELO_RESPALDO = process.env.GEMINI_MODEL_RESPALDO || '';
const INTENTOS_POR_MODELO = 3;
const ESPERA_BASE_MS = 1500;
const MAX_MENSAJE = 1000;
const MAX_HISTORIAL = 10;
const TIEMPO_MAXIMO_MS = 15000;

const INSTRUCCIONES = `Eres el Asistente PREICFES, un tutor amable que ayuda a estudiantes colombianos a prepararse para el examen Saber 11 (ICFES).
Temas: Lectura crítica, Matemáticas, Sociales y ciudadanas, Ciencias naturales e Inglés, además de técnicas de estudio, manejo del tiempo y estrategias para el examen.
Reglas:
- Responde siempre en español, con lenguaje claro y cercano, salvo que el estudiante practique inglés.
- Explica paso a paso y con ejemplos cortos. Sé breve: máximo unos 150 palabras salvo que pidan más detalle.
- Si el estudiante pide resolver una pregunta, guíalo con el razonamiento y no solo des la letra de la respuesta.
- Si preguntan algo que no tiene que ver con el estudio ni con el ICFES, responde en una frase que solo puedes ayudar con la preparación del examen y ofrece un tema relacionado.
- Si no estás seguro de algo, dilo. No inventes datos.
- Puedes usar **negrita**, \`código\` y viñetas con "-".`;

// Convierte el historial del front ({ rol: 'usuario'|'bot', texto }) al formato de Gemini
// (roles 'user' y 'model', que deben alternar y empezar con 'user').
function construirContenido(historial, mensaje) {
    const turnos = [];
    const lista = Array.isArray(historial) ? historial.slice(-MAX_HISTORIAL) : [];

    for (const item of lista) {
        if (!item || typeof item.texto !== 'string' || !item.texto.trim()) continue;
        const role = item.rol === 'usuario' ? 'user' : item.rol === 'bot' ? 'model' : null;
        if (!role) continue;
        const texto = item.texto.slice(0, 4000);
        const ultimo = turnos[turnos.length - 1];
        if (ultimo && ultimo.role === role) {
            ultimo.parts[0].text += `\n${texto}`;
        } else {
            turnos.push({ role, parts: [{ text: texto }] });
        }
    }

    while (turnos.length && turnos[0].role !== 'user') turnos.shift();

    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.role === 'user') {
        ultimo.parts[0].text += `\n${mensaje}`;
    } else {
        turnos.push({ role: 'user', parts: [{ text: mensaje }] });
    }
    return turnos;
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Llama a Gemini; si el modelo está saturado (500/503/504) o tarda de más, reintenta
// con una pausa creciente y, si hay modelo de respaldo, lo prueba después.
async function consultarGemini(apiKey, cuerpo) {
    const modelos = [MODELO, MODELO_RESPALDO].filter((m, i, a) => m && a.indexOf(m) === i);
    let ultima = null;

    for (const modelo of modelos) {
        for (let intento = 1; intento <= INTENTOS_POR_MODELO; intento++) {
            const controlador = new AbortController();
            const temporizador = setTimeout(() => controlador.abort(), TIEMPO_MAXIMO_MS);
            try {
                const resp = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                        body: cuerpo,
                        signal: controlador.signal
                    }
                );
                if (resp.ok) return { resp, modelo };

                const detalle = await resp.text().catch(() => '');
                console.error(`Chat: Gemini respondió ${resp.status} (modelo ${modelo}, intento ${intento}):`, detalle.slice(0, 300));
                ultima = { status: resp.status };
                // Solo vale la pena reintentar errores temporales del servidor
                if (![500, 502, 503, 504].includes(resp.status)) return { error: ultima };
            } catch (e) {
                console.error(`Chat: ${e && e.name === 'AbortError' ? 'Gemini tardó demasiado' : e} (modelo ${modelo}, intento ${intento})`);
                ultima = { status: 504 };
            } finally {
                clearTimeout(temporizador);
            }
            if (intento < INTENTOS_POR_MODELO) await dormir(ESPERA_BASE_MS * intento);
        }
    }
    return { error: ultima || { status: 502 } };
}

const responder = async (req, res) => {
    try {
        const body = req.body || {};
        const mensaje = typeof (body.mensaje ?? body.message) === 'string'
            ? (body.mensaje ?? body.message).trim()
            : '';
        const historial = body.historial ?? body.history;

        if (!mensaje) {
            return res.status(400).json({ mensaje: 'Escribe una pregunta.' });
        }
        if (mensaje.length > MAX_MENSAJE) {
            return res.status(400).json({ mensaje: `La pregunta es muy larga (máximo ${MAX_MENSAJE} caracteres).` });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('Chat: falta GEMINI_API_KEY en el .env del backend');
            return res.status(500).json({ mensaje: 'El asistente no está configurado todavía.' });
        }

        const cuerpo = JSON.stringify({
            systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
            contents: construirContenido(historial, mensaje),
            generationConfig: { temperature: 0.6, maxOutputTokens: 800 }
        });

        const resultado = await consultarGemini(apiKey, cuerpo);

        if (resultado.error) {
            const { status } = resultado.error;
            if (status === 429) {
                return res.status(429).json({ mensaje: 'El asistente está muy ocupado. Espera un momento e intenta de nuevo.' });
            }
            if ([500, 502, 503, 504].includes(status)) {
                return res.status(503).json({ mensaje: 'El asistente está saturado en este momento. Intenta de nuevo en unos segundos.' });
            }
            return res.status(502).json({ mensaje: 'No pude responder ahora. Intenta de nuevo.' });
        }

        const respuestaHttp = resultado.resp;
        const datos = await respuestaHttp.json();
        const candidato = datos.candidates && datos.candidates[0];
        const texto = candidato && candidato.content && Array.isArray(candidato.content.parts)
            ? candidato.content.parts.map((p) => p.text || '').join('').trim()
            : '';

        if (!texto) {
            return res.status(502).json({ mensaje: 'No pude generar una respuesta para eso. Intenta reformular la pregunta.' });
        }

        res.json({ respuesta: texto });
    } catch (error) {
        console.error('Chat:', error && error.name === 'AbortError' ? 'Gemini tardó demasiado' : error);
        res.status(500).json({ mensaje: 'No pude responder ahora. Intenta de nuevo.' });
    }
};

module.exports = { responder };