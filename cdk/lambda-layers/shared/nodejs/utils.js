const zlib = require('zlib');

/**
 * Compress data using gzip
 */
function compress(data) {
  const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
  return zlib.gzipSync(jsonString).toString('base64');
}

/**
 * Decompress gzipped data
 */
function decompress(compressedData) {
  const buffer = Buffer.from(compressedData, 'base64');
  const decompressed = zlib.gunzipSync(buffer).toString();
  try {
    return JSON.parse(decompressed);
  } catch (e) {
    return decompressed;
  }
}

/**
 * Generate TTL timestamp (7 days from now)
 */
function generateTTL(days = 7) {
  return Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60);
}

/**
 * Format date as YYYYMMDD
 */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Check if date is within hot data range (last 7 days)
 */
function isHotData(dateStr) {
  const date = new Date(dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8));
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return date >= sevenDaysAgo;
}

/**
 * Generate partition key for DynamoDB
 */
function generatePK(clientId, host, date) {
  return `${clientId}#${host}#${date}`;
}

/**
 * Parse partition key
 */
function parsePK(pk) {
  const parts = pk.split('#');
  return {
    clientId: parts[0],
    host: parts[1],
    date: parts[2]
  };
}

/**
 * Generate S3 key for monthly data
 */
function generateMonthlyS3Key(clientId, yearMonth) {
  return `clients/${clientId}/monthly/${yearMonth}.json.gz`;
}

/**
 * Generate S3 key for daily data
 */
function generateDailyS3Key(clientId, date) {
  return `clients/${clientId}/daily/${date}.json.gz`;
}

module.exports = {
  compress,
  decompress,
  generateTTL,
  formatDate,
  isHotData,
  generatePK,
  parsePK,
  generateMonthlyS3Key,
  generateDailyS3Key
};