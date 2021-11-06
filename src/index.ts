import express from 'express';
import path from 'path';
const app = express();
const port = process.env.PORT || 8002;

app.use("/static", express.static('public'));

app.get( "/", (req, res) => {
    res.sendFile(path.join(__dirname, '../html/index.html'));
});

app.listen( port, () => {
    console.log(`Server started at http://localhost:${port}`);
})