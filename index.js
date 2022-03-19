#!/usr/bin/env node

const actual = require('@actual-app/api');
const colors = require('colors/safe');
const d = require('date-fns');

let budgets = {};
let force = process.argv.indexOf('--force') > 0;
let preview = process.argv.indexOf('--preview') > 0;
if(!process.argv[2]) {
    console.log(colors.red('node index.js budget-id [yyyy-mm] [--force] [--preview]'));
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
                    let to_budget = await applyTemplate(category, template, month);
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
        { type: 'simple', re: /^#template \$?(\-?\d+(\.\d{2})?)$/im, params: ['monthly'] },
        { type: 'simple', re: /^#template up to \$?(\d+(\.\d{2})?)$/im, params: ['limit'] },
        { type: 'simple', re: /^#template \$?(\d+(\.\d{2})?) up to \$?(\d+(\.\d{2})?)$/im, params: ['monthly', null, 'limit'] },
        { type: 'by', re: /^#template \$?(\d+(\.\d{2})?) by (\d{4}\-\d{2})$/im, params: ['amount', null, 'month'] },
        { type: 'by', re: /^#template \$?(\d+(\.\d{2})?) by (\d{4}\-\d{2}) repeat every (\d+) months$/im, params: ['amount', null, 'month', 'repeat'] },
        { type: 'week', re: /^#template \$?(\d+(\.\d{2})?) repeat every week starting (\d{4}\-\d{2}\-\d{2})$/im, params: ['amount', null, 'starting'] },
        { type: 'week', re: /^#template \$?(\d+(\.\d{2})?) repeat every week starting (\d{4}\-\d{2}\-\d{2}) up to \$?(\d+(\.\d{2})?)$/im, params: ['amount', null, 'starting', 'limit'] },
        { type: 'weeks', re: /^#template \$?(\d+(\.\d{2})?) repeat every (\d+) weeks starting (\d{4}\-\d{2}\-\d{2})$/im, params: ['amount', null, 'weeks', 'starting'] },
        { type: 'weeks', re: /^#template \$?(\d+(\.\d{2})?) repeat every (\d+) weeks starting (\d{4}\-\d{2}\-\d{2}) up to \$?(\d+(\.\d{2})?)$/im, params: ['amount', null, 'weeks', 'starting', 'limit'] },
        { type: 'by_annual', re: /^#template \$?(\d+(\.\d{2})?) by (\d{4}\-\d{2}) repeat every year$/im, params: ['amount', null, 'month'] },
        { type: 'by_annual', re: /^#template \$?(\d+(\.\d{2})?) by (\d{4}\-\d{2}) repeat every (\d+) years$/im, params: ['amount', null, 'month', 'repeat'] },
        { type: 'spend', re: /^#template \$?(\d+(\.\d{2})?) by (\d{4}\-\d{2}) spend from (\d{4}\-\d{2})$/im, params: ['amount', null, 'to', 'from'] },
        { type: 'error', re: /^#template .*$/im, params: []}
    ];

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
                notes[results.data[i].id] = note;
                break;
            }
        }
    };
    return notes;
}

async function applyTemplate(category, template, month) {
    const balance = category.balance - category.spent - category.budgeted;
    let to_budget;
    switch(template.type) {
        case 'simple': {
            // simple has 'monthly' and/or 'limit' params
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
            break;
        }
        case 'by': 
        case 'by_annual': {
            // by has 'amount' and 'month' params
            let target_month = new Date(`${template.month}-01`);
            let current_month = new Date(`${month}-01`);
            let target = actual.utils.amountToInteger(template.amount);
            let num_months = d.differenceInCalendarMonths(target_month, current_month);
            let repeat = template.type == 'by' ? template.repeat : (template.repeat || 1) * 12;
            while(num_months < 0 && repeat) {
                target_month = d.addMonths(target_month, repeat);
                num_months = d.differenceInCalendarMonths(target_month, current_month);
            }
            if(num_months < 0) {
                console.log(`${category.name}: ${colors.yellow(`${template.month} is in the past:`)} ${colors.cyan(template.line)}`);
                return null;
            } else {
                to_budget = target - balance;
                if (num_months > 0 && to_budget > 0) { 
                    to_budget = Math.round(to_budget / (num_months + 1));
                }
            }
            break;
        }
        case 'week':
        case 'weeks': {
            // weeks has 'amount', 'starting' and optional 'limit' params
            // weeks has 'amount', 'starting', 'weeks' and optional 'limit' params
            let amount = actual.utils.amountToInteger(template.amount);
            let weeks = template.weeks != null ? Math.round(template.weeks) : 1;
            let limit = template.limit != null ? actual.utils.amountToInteger(template.limit) : null;
            let w = new Date(template.starting);

            let current_month = new Date(`${month}-01`);
            let next_month = d.addMonths(current_month, 1)

            to_budget = 0;
            while(w.getTime() < next_month.getTime()) {
                if(w.getTime() >= current_month.getTime()) {
                    to_budget += amount;
                }
                w = d.addWeeks(w, weeks)
            }            

            if(limit != null) {
                if(to_budget + balance > limit) {
                    to_budget = limit - balance;
                }
            }
            break;
        }
        case 'spend': {
            // spend has 'amount' and 'from' and 'to' params
            let from_month = new Date(`${template.from}-01`);
            let to_month = new Date(`${template.to}-01`);
            let current_month = new Date(`${month}-01`);
            let already_budgeted;
            let first_month = true;
            for(let month = from_month; d.differenceInCalendarMonths(current_month, month) > 0; month = d.addMonths(month, 1)) {
                let budget = await getBudgetMonth(d.format(month, 'yyyy-MM'));
                for(var g = 0; g < budget.categoryGroups.length; g++) {
                    if(category.group_id == budget.categoryGroups[g].id) {
                        for(var c = 0; c < budget.categoryGroups[g].categories.length; c++)
                        if(category.id == budget.categoryGroups[g].categories[c].id) {
                            let month_category = budget.categoryGroups[g].categories[c]; 
                            if(first_month) {
                                already_budgeted = month_category.balance - month_category.spent;
                                first_month = false;
                            } else {
                                already_budgeted += month_category.budgeted;
                            }
                            break;
                        }
                        break;
                    }
                }
            }
            let num_months = d.differenceInCalendarMonths(to_month, current_month);
            let target = actual.utils.amountToInteger(template.amount);
            if(num_months < 0) {
                console.log(`${category.name}: ${colors.yellow(`${template.to} is in the past:`)} ${colors.cyan(template.line)}`);
                return null;
            } else if (num_months == 0) { 
                to_budget = target - already_budgeted;
            } else {
                to_budget = Math.round((target - already_budgeted) / (num_months + 1));
            }
            break;
        }
        case 'error':
            console.log(`${category.name}: ${colors.red(`Failed to match:`)} ${colors.cyan(template.line)}`);
            return null;
    }

    if((category.budgeted != 0 || to_budget == 0) && !force) {
        return null;
    } else if(category.budgeted == to_budget && force) {
        return null;
    } else {
        console.log(`${category.name}: ${actual.utils.integerToAmount(balance)} + ${colors.green(actual.utils.integerToAmount(to_budget))} = ${actual.utils.integerToAmount(balance + to_budget)} ${colors.cyan(template.line)}`);
        return to_budget;
    }
}

async function getBudgetMonth(month) {
    if(!budgets[month]) {
        budgets[month] = await actual.getBudgetMonth(month);;
    }
    return budgets[month];
}


