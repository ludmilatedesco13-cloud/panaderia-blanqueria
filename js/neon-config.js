// js/neon-config.js

// 1. Cargar el driver oficial Serverless de Neon desde CDN
import { neon } from 'https://esm.sh/@neondatabase/serverless';

// 2. Colocar aquí la cadena de conexión completa que copiaste de Neon
const DATABASE_URL = 'postgresql://neondb_owner:npg_ADCz0YVmR2kP@ep-proud-sound-b4iv5w7y-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const DATABASE_CONFIGURED = !DATABASE_URL.includes('******');

// 3. Inicializar la función de consultas HTTP
const sql = neon(DATABASE_URL);

/**
 * Función global para ejecutar consultas SQL en Neon
 * @param {string} queryText - Consulta SQL con parámetros numerados ($1, $2, etc.)
 * @param {Array} params - Arreglo con los valores de los parámetros
 */
async function executeNeonQuery(queryText, params = []) {
    try {
        if (!DATABASE_CONFIGURED) {
            throw new Error('La URL de conexión de Neon no está configurada. Reemplazá DATABASE_URL por la URL completa de tu proyecto.');
        }

        // Enviar la consulta y sus parámetros al motor Serverless de Neon
        const rows = await sql.query(queryText, params);
        return rows;
    } catch (error) {
        console.error('Error al ejecutar la consulta en Neon:', error);
        throw error;
    }
}

// Hacer la función accesible globalmente para app.js
window.executeNeonQuery = executeNeonQuery;