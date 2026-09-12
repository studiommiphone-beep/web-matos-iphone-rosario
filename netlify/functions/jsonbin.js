exports.handler = async (event) => {
  const BIN_ID = process.env.JSONBIN_BIN_ID;
  const API_KEY = process.env.JSONBIN_KEY;
  const URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': API_KEY
  };

  try {
    // LEER DATOS (GET)
    if (event.httpMethod === 'GET') {
      const response = await fetch(`${URL}/latest`, { method: 'GET', headers });
      const data = await response.json();
      
      // Devuelve data.record si existe, o el objeto directo
      const recordData = data.record ? data.record : data;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      };
    }

    // GUARDAR DATOS (PUT)
    if (event.httpMethod === 'PUT') {
      const bodyData = JSON.parse(event.body);
      const response = await fetch(URL, {
        method: 'PUT',
        headers,
        body: JSON.stringify(bodyData)
      });
      const data = await response.json();

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.record || data)
      };
    }

    return { 
      statusCode: 405, 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido' }) 
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};