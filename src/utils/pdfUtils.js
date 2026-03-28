const axios = require('axios');
const pdf = require('pdf-parse');
const fs = require('fs');

/**
 * Function to fetch PDF from URL
 * @param {string} url - PDF URL
 * @returns {Promise<Buffer>} PDF buffer
 */
async function fetchPDF(url) {
    try {
        console.log(`Fetching PDF from: ${url}`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000, // 30 second timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        return Buffer.from(response.data);
    } catch (error) {
        console.error(`Error fetching PDF from ${url}:`, error.message);
        throw new Error(`Failed to fetch PDF: ${error.message}`);
    }
}

/**
 * Function to read PDF content
 * @param {Buffer} pdfBuffer - PDF buffer
 * @returns {Promise<string>} Extracted text
 */
async function readPDF(pdfBuffer) {
    try {
        console.log('Reading PDF content...');
        const data = await pdf(pdfBuffer);
        return data.text;
    } catch (error) {
        console.error('Error reading PDF:', error.message);
        throw new Error(`Failed to read PDF: ${error.message}`);
    }
}

/**
 * Function to read only first two pages of PDF content
 * @param {Buffer} pdfBuffer - PDF buffer
 * @returns {Promise<string>} Extracted text from first two pages
 */
async function readPDFFirstTwoPages(pdfBuffer) {
    try {
        console.log('Reading first two pages of PDF content...');
        const data = await pdf(pdfBuffer, {
            max: 2  // Limit to first 2 pages
        });
        return data.text;
    } catch (error) {
        console.error('Error reading PDF first two pages:', error.message);
        throw new Error(`Failed to read PDF first two pages: ${error.message}`);
    }
}

/**
 * Function to read PDF from local file path
 * @param {string} filePath - Local file path
 * @returns {Promise<Buffer>} PDF buffer
 */
function readPDFFromFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        return fs.readFileSync(filePath);
    } catch (error) {
        console.error(`Error reading PDF file ${filePath}:`, error.message);
        throw error;
    }
}

function removeMarkdownCodeBlock(str) {
    // Remove ```json from beginning and ``` from end
    return str.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
}

module.exports = {
    fetchPDF,
    readPDF,
    readPDFFirstTwoPages,
    readPDFFromFile,
    removeMarkdownCodeBlock
};