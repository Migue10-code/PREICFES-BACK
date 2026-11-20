// Framework principal
const express = require('express');

// Permite peticiones desde otros dominios
const cors = require('cors');

const app = express();

// Middleware para recibir JSON
app.use(express.json());

// Middleware CORS: si existe FRONTEND_URL (separadas por coma), solo esos sitios pueden llamar a la API
const origenesPermitidos = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((o) => o.trim())
    : true;
app.use(cors({ origin: origenesPermitidos }));

const db = require('./config/database');

// Importar rutas
const areasRoutes = require('./routes/Areas.routes');
const estudiantesRoutes = require('./routes/Estudiantes.routes');
const usuariosRoutes = require('./routes/Usuarios.routes');
const temasRoutes = require('./routes/Temas.routes');
const preguntasRoutes = require('./routes/Preguntas.routes');
const respuestasRoutes = require('./routes/Respuestas.routes');
const intentosRoutes = require('./routes/Intentos.routes');
const intentosrespuestasRoutes = require('./routes/IntentosRespuestas.routes');
const chatRoutes = require('./routes/Chat.routes');

// Registrar rutas
app.use('/api/areas', areasRoutes);
app.use('/api/estudiantes', estudiantesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/temas', temasRoutes);
app.use('/api/preguntas', preguntasRoutes);
app.use('/api/respuestas', respuestasRoutes);
app.use('/api/intentos', intentosRoutes);
app.use('/api/intentosrespuestas', intentosrespuestasRoutes);
app.use('/api/chat', chatRoutes);

// Comprueba que el servidor y la base de datos responden
app.get('/api/salud', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ estado: 'ok', baseDeDatos: 'conectada' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ estado: 'error', baseDeDatos: 'sin conexión' });
    }
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;
// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en puerto ${PORT}`);
});
