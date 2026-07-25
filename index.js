const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all domains so any external player can use this proxy
app.use(cors());

app.get('/', async (req, res) => {
    const targetUrl = req.query.url;
    
    // If no URL is provided, return a simple status message instead of a webpage
    if (!targetUrl) {
        return res.status(400).send('HLS CORS Proxy is running. Please provide a stream via the "?url=" query parameter.');
    }

    // Generate the proxy base URL (e.g., https://your-app.onrender.com/?url=)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const proxyBaseUrl = `${protocol}://${host}/?url=`;

    try {
        const response = await axios.get(targetUrl, { responseType: 'stream' });
        const contentType = response.headers['content-type'] || '';
        const isPlaylist = contentType.includes('mpegurl') || targetUrl.includes('.m3u8');

        if (isPlaylist) {
            const data = await new Promise((resolve, reject) => {
                let chunks = [];
                response.data.on('data', chunk => chunks.push(chunk));
                response.data.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                response.data.on('error', reject);
            });

            const baseUrl = new URL(targetUrl);
            const lines = data.split('\n');
            
            const rewrittenLines = lines.map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;
                
                if (trimmed.startsWith('#EXT-X-KEY')) {
                    return line.replace(/URI=["']([^"']+)["']/, (match, uri) => {
                        const absoluteUri = new URL(uri, baseUrl.href).href;
                        return `URI="${proxyBaseUrl}${encodeURIComponent(absoluteUri)}"`;
                    });
                }
                
                if (trimmed.startsWith('#')) return line;
                
                const absoluteUri = new URL(trimmed, baseUrl.href).href;
                return `${proxyBaseUrl}${encodeURIComponent(absoluteUri)}`;
            });

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.send(rewrittenLines.join('\n'));
        } else {
            res.setHeader('Content-Type', contentType);
            response.data.pipe(res);
        }
    } catch (error) {
        console.error(`Error fetching ${targetUrl}:`, error.message);
        res.status(500).send('Error proxying the request.');
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
