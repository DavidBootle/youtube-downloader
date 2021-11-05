const express = require('express');
const app = express();
const port = process.env.PORT || 8001;

app.get( "/", (req, res) => {
    res.send('Hello world!');
});

app.listen( port, () => {
    console.log(`Server started at http://localhost:${port}`);
})