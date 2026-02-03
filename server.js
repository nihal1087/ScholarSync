const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_PATH = path.join(__dirname, 'data', 'scholarships.json');
let SCHOLARSHIPS = [];

try {
    const rawData = fs.readFileSync(DATA_PATH);
    SCHOLARSHIPS = JSON.parse(rawData);
    console.log(`✅ Database loaded: ${SCHOLARSHIPS.length} scholarships.`);
} catch (error) {
    console.error("❌ Error: 'data/scholarships.json' is missing or invalid.");
}

app.post('/chat', (req, res) => {
    const { state, gender, education } = req.body; 
    
    console.log("🔍 Search:", req.body); 

    let matches = SCHOLARSHIPS.filter(item => {
        const t = item.tags;
        if (!t) return false;

        const itemState = (t.state || "").toLowerCase();
        const userState = (state || "").toLowerCase();
        const stateMatch = 
            userState === "all india" || 
            itemState === "all india" || 
            itemState.includes(userState);

        const itemGender = (t.gender || "All").toLowerCase();
        const userGender = (gender || "All").toLowerCase();
        const genderMatch = 
            itemGender === "all" || 
            itemGender === userGender;

        const itemClasses = (t.class || []).map(c => c.toLowerCase());
        const userClass = (education || "").toLowerCase();
        
        let searchClass = userClass;
        if (userClass === 'ug' || userClass.includes('undergrad')) searchClass = 'ug';
        if (userClass === 'pg' || userClass.includes('postgrad') || userClass.includes('master')) searchClass = 'pg';
        if (userClass.includes('12')) searchClass = 'class 12';
        if (userClass.includes('10')) searchClass = 'class 10';

        const classMatch = itemClasses.some(c => c.includes(searchClass));

        return stateMatch && genderMatch && classMatch;
    });

    matches.sort((a, b) => {
        const dateA = new Date(a.application_deadline);
        const dateB = new Date(b.application_deadline);
        return dateA - dateB;
    });

    res.json({
        reply: matches.length > 0 
            ? `Found <b>${matches.length}</b> matches for ${gender}, ${education} in ${state}.` 
            : `No exact matches found. Try broadening your search to "All India".`,
        results: matches
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Bot running at http://localhost:${PORT}`);
});