const actual = require('@actual-app/api');
const colors = require('colors/safe');
const d = require('date-fns');

let budgets = {};
let force = process.argv.indexOf('--force') > 0;
let preview = process.argv.indexOf('--preview') > 0;
if(!process.argv[2]) {
    console.log(colors.red('node index.js budget-id [yyyy-mm] [--force]'));
    return;
}

actual.runWithBudget(process.argv[2], run);

async function run() {

    let month = (/\d{4}\-\d{2}/.exec(process.argv[3]) || [])[0] || d.format(new Date(), 'yyyy-MM');
    
    let category_notes = await getCategoryNotes();

    let budget = await actual.getBudgetMonth(month);
    let num_applied = 0;
    for(let g = 0; g < budget.categoryGroups.length; g++) {
        for(let c = 0; c < budget.categoryGroups[g].categories.length; c++) {
            let category = budget.categoryGroups[g].categories[c];
            if(category.budgeted == 0 || force) {
                let template = category_notes[category.id];
                if(template) {
                    let to_budget = applyTemplate(category, template);
                    if(to_budget != null) {
                        num_applied++;
                        if(!preview) {
                            await actual.setBudgetAmount(month, category.id,  to_budget);    
                        }
                    }
                }
            }
        }
    }
    if(num_applied == 0) {
        console.log(colors.green('All categories were up to date.'));
    } else {
        if(preview) {
            console.log(colors.green(`${num_applied} categories to update.`));
        } else {
            console.log(colors.green(`${num_applied} categories updated.`));    
        }
    }
}


async function getCategoryNotes() {

    const matches = [
        { type: 'simple', re: /^#template \$?(\d+(\.\d{2})?)$/im, params: ['monthly'] },
        { type: 'simple', re: /^#template up to \$?(\d+(\.\d{2})?)$/im, params: ['limit'] },
        { type: 'simple', re: /^#template \$?(\d+(\.\d{2})?) up to \$?(\d+(\.\d{2})?)$/im, params: ['monthly', null, 'limit'] },
    ] ;

    let results = await actual.runQuery(actual.q('notes').filter({ note: { $like: '%#template%'}}).select('*'));
    let notes = {};
    for(let i = 0; i < results.data.length; i++) {
        let note = { 
            text: results.data[i].note
        }
        for(let m = 0; m < matches.length; m++) {
            let arr = matches[m].re.exec(note.text);
            if(arr) {
                note.line = arr[0];
                note.type = matches[m].type;
                for(let p = 0; p < matches[m].params.length; p++) {
                    let param_name = matches[m].params[p];
                    if(param_name) {
                        note[param_name] = arr[p+1];
                    }
                }
                break;
            }
        }
        notes[results.data[i].id] = note;
    };
    return notes;
}

function applyTemplate(category, template) {
    switch(template.type) {
        case 'simple':
            // simple has 'monthly' and/or 'limit' params
            let to_budget = 0;
            let balance = category.balance - category.spent - category.budgeted;
            let limit = template.limit != null ? actual.utils.amountToInteger(template.limit) : null;
            if(template.monthly) {
                let monthly = actual.utils.amountToInteger(template.monthly);
                to_budget = monthly;
                if(limit != null) {
                    if(monthly + balance > limit) {
                        to_budget = limit - balance;
                    }
                }
            } else {
                to_budget = limit - balance;
            }
            if(category.budgeted == to_budget && !force) {
                return null;
            } else {
                console.log(`${category.name}: ${actual.utils.integerToAmount(balance)} + ${colors.green(actual.utils.integerToAmount(to_budget))} = ${actual.utils.integerToAmount(balance + to_budget)} ${colors.cyan(template.line)}`);
                return to_budget;    
            }

    }

    return null;
}

async function getBudgetMonth(month) {
    if(!budgets[month]) {
        budgets[month] = await actual.getBudgetMonth(month);;
    }
    return budgets[month];
}


