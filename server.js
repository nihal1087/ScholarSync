const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Load Data
const DATA_PATH = path.join(__dirname, 'data', 'scholarships.json');
let SCHOLARSHIPS = [];

try {
    const rawData = fs.readFileSync(DATA_PATH);
    SCHOLARSHIPS = JSON.parse(rawData);
    console.log(`✅ Database loaded: ${SCHOLARSHIPS.length} scholarships.`);
} catch (error) {
    console.error("❌ Error: 'data/scholarships.json' is missing.");
}

app.post('/chat', (req, res) => {
    const { category, state, gender, education, percentage, income } = req.body; 
    
    const userScore = parseFloat(percentage) || 0; 
    const userIncome = parseInt(income) || 999999999; 

    console.log("🔍 Filter Request:", req.body); 

    let matches = SCHOLARSHIPS.filter(item => {
        if (!item || !item.tags) return false;

        const t = item.tags;
        const reqs = item.requirements || { min_percentage: 0, max_family_income: 999999999 };

      
        const catMatch = !category || category === "All" || (item.category && item.category === category);

        const itemState = (t.state || "").toLowerCase();
        const userState = (state || "").toLowerCase();
        const stateMatch = 
            userState === "all india" || 
            itemState === "all india" || 
            itemState.includes(userState);

        const itemGender = (t.gender || "All").toLowerCase();
        const userGender = (gender || "All").toLowerCase();
        const genderMatch = itemGender === "all" || itemGender === userGender;

        const itemClasses = (t.class || []).map(c => c.toLowerCase());
        const userClass = (education || "").toLowerCase();
        let searchClass = userClass;
        
        if (userClass.includes('ug') || userClass.includes('undergrad')) searchClass = 'ug';
        if (userClass.includes('pg') || userClass.includes('master')) searchClass = 'pg';
        if (userClass.includes('12')) searchClass = 'class 12';
        if (userClass.includes('10')) searchClass = 'class 10';
        if (userClass.includes('phd')) searchClass = 'ph.d.';

        const classMatch = itemClasses.some(c => c.includes(searchClass)) || itemClasses.length === 0;

      
        const scoreMatch = userScore >= reqs.min_percentage;

        
        const incomeMatch = userIncome <= reqs.max_family_income;

        return catMatch && stateMatch && genderMatch && classMatch && scoreMatch && incomeMatch;
    });

    matches.sort((a, b) => {
        if (!a.application_deadline) return 1;
        if (!b.application_deadline) return -1;
        return new Date(a.application_deadline) - new Date(b.application_deadline);
    });

    res.json({
        reply: matches.length > 0 
            ? `Found <b>${matches.length}</b> opportunities matching your profile.` 
            : `No exact matches found for your criteria.`,
        results: matches
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port http://localhost:${PORT}`);
});