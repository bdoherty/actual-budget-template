#!/usr/bin/env node

const actual = require('@actual-app/api');
const colors = require('colors/safe');
const { differenceInCalendarMonths, addMonths, addWeeks, format } = require('date-fns');


let budgets = {};
let force = process.argv.indexOf('--force') > 0;
let preview = process.argv.indexOf('--preview') > 0;

switch(process.argv[2]) {
    case null: 
        console.log(colors.red('actual-budget-template budget-id [yyyy-mm] [--force] [--preview]'));
        break;
    case '--run-tests':
        runTests();
        break;
    default:
        actual.runWithBudget(process.argv[2], run);
}


async function run() {
    
    let month = (/\d{4}\-\d{2}/.exec(process.argv[3]) || [])[0] || format(new Date(), 'yyyy-MM');
    
    let notes = (await actual.runQuery(actual.q('notes').filter({ note: { $like: '%#template%'}}).select('*'))).data;
    let category_templates = await getCategoryTemplates(notes);

    let budget = await actual.getBudgetMonth(month);
    let num_applied = 0;
    for(let g = 0; g < budget.categoryGroups.length; g++) {
        for(let c = 0; c < budget.categoryGroups[g].categories.length; c++) {
            let category = budget.categoryGroups[g].categories[c];
            if(category.budgeted == 0 || force) {
                let template = category_templates[category.id];
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


async function getCategoryTemplates(notes) {

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

    let templates = {};
    for(let n = 0; n < notes.length; n++) {
        let lines = notes[n].note.split('\n');
        let template_lines = [];            
        for(let l = 0; l < lines.length; l++) {            
            for(let m = 0; m < matches.length; m++) {
                let arr = matches[m].re.exec(lines[l]);
                if(arr) {
                    let matched = {};
                    matched.line = arr[0];
                    matched.type = matches[m].type;
                    for(let p = 0; p < matches[m].params.length; p++) {
                        let param_name = matches[m].params[p];
                        if(param_name) {
                            matched[param_name] = arr[p+1];
                        }
                    }
                    template_lines.push(matched);
                    break;
                }
            }
        }
        if(template_lines.length) {
            templates[notes[n].id] = template_lines;
        }
    }
    return templates;
}

async function applyTemplate(category, template_lines, month, getBudgetMonthTestFunc = null) {
    let to_budget = 0;
    let limit;
    let last_month_balance = category.balance - category.spent - category.budgeted;
    for(let l = 0; l < template_lines.length; l++) {
        let template = template_lines[l];
        switch(template.type) {
            case 'simple': {
                // simple has 'monthly' and/or 'limit' params
                if(template.limit != null) {
                    if(limit != null) {
                        console.log(`${category.name}: ${colors.red(`More than one 'up to' limit found.`)} ${colors.cyan(template.line)}`);
                        return null;
                    } else {
                        limit = actual.utils.amountToInteger(template.limit)
                    }
                }
                if(template.monthly) {
                    let monthly = actual.utils.amountToInteger(template.monthly);
                    to_budget += monthly;
                } else {
                    to_budget += limit ;
                }
                break;
            }
            case 'by': 
            case 'by_annual': {
                // by has 'amount' and 'month' params
                let target_month = new Date(`${template.month}-01`);
                let current_month = new Date(`${month}-01`);
                let target = actual.utils.amountToInteger(template.amount);
                let num_months = differenceInCalendarMonths(target_month, current_month);
                let repeat = template.type == 'by' ? template.repeat : (template.repeat || 1) * 12;
                while(num_months < 0 && repeat) {
                    target_month = addMonths(target_month, repeat);
                    num_months = differenceInCalendarMonths(target_month, current_month);
                }
                if(num_months < 0) {
                    console.log(`${category.name}: ${colors.yellow(`${template.month} is in the past:`)} ${colors.cyan(template.line)}`);
                    return null;
                } else {
                    to_budget = target - last_month_balance;
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
                if(template.limit != null) {
                    if(limit != null) {
                        console.log(`${category.name}: ${colors.red(`More than one 'up to' limit found.`)} ${colors.cyan(template.line)}`);
                        return null;
                    } else {
                        limit = actual.utils.amountToInteger(template.limit)
                    }
                }
                let w = new Date(template.starting);

                let current_month = new Date(`${month}-01`);
                let next_month = addMonths(current_month, 1)

                to_budget = 0;
                while(w.getTime() < next_month.getTime()) {
                    if(w.getTime() >= current_month.getTime()) {
                        to_budget += amount;
                    }
                    w = addWeeks(w, weeks)
                }            
                break;
            }
            case 'spend': {
                // spend has 'amount' and 'from' and 'to' params
                let from_month = new Date(`${template.from}-01`);
                let to_month = new Date(`${template.to}-01`);
                let current_month = new Date(`${month}-01`);
                let already_budgeted = last_month_balance;
                let first_month = true;
                ////console.log(month, category);
                for(let m = from_month; differenceInCalendarMonths(current_month, m) > 0; m = addMonths(m, 1)) {
                    let func = (getBudgetMonthTestFunc || getBudgetMonth);
                    let budget = await func(format(m, 'yyyy-MM'));
                    for(var g = 0; g < budget.categoryGroups.length; g++) {
                        if(category.group_id == budget.categoryGroups[g].id) {
                            for(var c = 0; c < budget.categoryGroups[g].categories.length; c++)
                            if(category.id == budget.categoryGroups[g].categories[c].id) {
                                let month_category = budget.categoryGroups[g].categories[c]; 
                                ////console.log(m, month_category);
                                if(first_month) {
                                    already_budgeted = month_category.balance - month_category.spent;
                                    first_month = false;
                                } else {
                                    already_budgeted += month_category.budgeted;
                                }
                                ////console.log(`${month} already_budgeted: ${already_budgeted}`)
                                break;
                            }
                            break;
                        }
                    }
                }
                let num_months = differenceInCalendarMonths(to_month, current_month);
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
    }

    if(limit != null) {
        if(to_budget + last_month_balance > limit) {
            to_budget = limit - last_month_balance;
        }
    }

    if(((category.budgeted != null && category.budgeted != 0) || to_budget == 0) && !force) {
        return null;
    } else if(category.budgeted == to_budget && force) {
        return null;
    } else {
        let str = category.name + ': ' + actual.utils.integerToAmount(last_month_balance);
        str += ' + ' + colors.green(actual.utils.integerToAmount(to_budget)) + ' = ' + actual.utils.integerToAmount(last_month_balance + to_budget);
        str += ' ' + colors.cyan(template_lines.map(x => x.line).join('\n'))
        console.log(str);
        return to_budget;
    }
}

async function getBudgetMonth(month) {
    if(!budgets[month]) {
        budgets[month] = await actual.getBudgetMonth(month);;
    }
    return budgets[month];
}

async function runTests() {

    let template, parsed;

    template = "#template 50";
    parsed = {"1":[{"line":template,"type":"simple","monthly":"50"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 5000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template up to 150';
    parsed = {"1":[{"line":template,"type":"simple","limit":"150"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 8000, await applyTemplate({ name: 'my-cat', balance: 7000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template $50 up to $300';
    parsed = {"1":[{"line": template,"type":"simple","monthly":"50","limit":"300"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 5000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 5000, await applyTemplate({ name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 2000, await applyTemplate({ name: 'my-cat', balance: 28000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template $50 up to $300\n#template 100';
    parsed = {"1":[{"line":"#template $50 up to $300","type":"simple","monthly":"50","limit":"300"},{"line":"#template 100","type":"simple","monthly":"100"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 15000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 15000, await applyTemplate({ name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 2000, await applyTemplate({ name: 'my-cat', balance: 28000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template $50 up to $300\n#template 100 up to 200';
    parsed = {"1":[{"line":"#template $50 up to $300","type":"simple","monthly":"50","limit":"300"},{"line":"#template 100 up to 200","type":"simple","monthly":"100","limit":"200"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, null, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template $500 by 2021-03 repeat every 6 months';
    parsed = {"1":[{"line":"#template $500 by 2021-03 repeat every 6 months","type":"by","amount":"500","month":"2021-03","repeat":"6"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 50000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 40000, await applyTemplate({ name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 8333, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-04') );
    test(template, 8333, await applyTemplate({ name: 'my-cat', balance: 8333, spent: 0, budgeted: 0 }, parsed['1'], '2022-05') );
    test(template, 8334, await applyTemplate({ name: 'my-cat', balance: 16666, spent: 0, budgeted: 0 }, parsed['1'], '2022-06') );
    test(template, 8333, await applyTemplate({ name: 'my-cat', balance: 25000, spent: 0, budgeted: 0 }, parsed['1'], '2022-07') );
    test(template, 8334, await applyTemplate({ name: 'my-cat', balance: 33333, spent: 0, budgeted: 0 }, parsed['1'], '2022-08') );
    test(template, 8333, await applyTemplate({ name: 'my-cat', balance: 41667, spent: 0, budgeted: 0 }, parsed['1'], '2022-09') );

    template = '#template $500 by 2021-09 repeat every year';
    parsed = {"1":[{"line":"#template $500 by 2021-09 repeat every year","type":"by_annual","amount":"500","month":"2021-09"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 5714, await applyTemplate({ name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 6667, await applyTemplate({ name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2022-04') );
    test(template, 8000, await applyTemplate({ name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2022-05') );

    template = '#template $500 by 2021-03 repeat every 2 years';
    parsed = {"1":[{"line":"#template $500 by 2021-03 repeat every 2 years","type":"by_annual","amount":"500","month":"2021-03","repeat":"2"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 3846, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 3077, await applyTemplate({ name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template $10 repeat every week starting 2022-01-03';
    parsed = {"1":[{"line":"#template $10 repeat every week starting 2022-01-03","type":"week","amount":"10","starting":"2022-01-03"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 4000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template $10 repeat every week starting 2022-01-04 up to 80';
    parsed = {"1":[{"line":"#template $10 repeat every week starting 2022-01-04 up to 80","type":"week","amount":"10","starting":"2022-01-04","limit":"80"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 4000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-02') );
    test(template, 5000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, 3000, await applyTemplate({ name: 'my-cat', balance: 5000, spent: 0, budgeted: 0 }, parsed['1'], '2022-04') );

    template = '#template $10 repeat every 2 weeks starting 2022-01-04';
    parsed = {"1":[{"line":"#template $10 repeat every 2 weeks starting 2022-01-04","type":"weeks","amount":"10","weeks":"2","starting":"2022-01-04"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 2000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-02') );
    test(template, 3000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );

    template = '#template $10 repeat every 9 weeks starting 2022-01-04 up to 30';
    parsed = {"1":[{"line":"#template $10 repeat every 9 weeks starting 2022-01-04 up to 30","type":"weeks","amount":"10","weeks":"9","starting":"2022-01-04","limit":"30"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    test(template, 1000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-01') );
    test(template, null, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-02') );
    test(template, 1000, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-03') );
    test(template, null, await applyTemplate({ name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2022-04') );

    template = '#template $1200 by 2021-12 spend from 2021-03';
    parsed = {"1":[{"line":"#template $1200 by 2021-12 spend from 2021-03","type":"spend","amount":"1200","to":"2021-12","from":"2021-03"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );

    let getBudgetMonthTestFunc = function (month) {
        switch(month) {
            case '2021-03':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', balance: 30000, spent: 0 }] }] };
            case '2021-04':
            case '2021-05':
            case '2021-06':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10000 }] }] };
        }
    };
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2021-01', () => {debugger} ) );
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 10000, spent: 0, budgeted: 0 }, parsed['1'], '2021-02', () => {debugger}) );
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 20000, spent: 0, budgeted: 0 }, parsed['1'], '2021-03', getBudgetMonthTestFunc) );
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 30000, spent: 0, budgeted: 0 }, parsed['1'], '2021-04', getBudgetMonthTestFunc) );
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 40000, spent: 0, budgeted: 0 }, parsed['1'], '2021-05', getBudgetMonthTestFunc) );
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 50000, spent: 0, budgeted: 0 }, parsed['1'], '2021-06', getBudgetMonthTestFunc) );
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 60000, spent: 0, budgeted: 0 }, parsed['1'], '2021-07', getBudgetMonthTestFunc) );

    template = '#template $1200 by 2021-12 spend from 2021-03';
    parsed = {"1":[{"line":"#template $1200 by 2021-12 spend from 2021-03","type":"spend","amount":"1200","to":"2021-12","from":"2021-03"}]};
    test(template, 
        parsed,
        await getCategoryTemplates([{ id: '1', note: template }])
    );
    getBudgetMonthTestFunc = function (month) {
        switch(month) {
            case '2021-03':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', balance: 13216, spent: -11385, budgeted: 10600 }] }] };
            case '2021-04':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600 }] }] };
            case '2021-05':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600 }] }] };
            case '2021-06':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600, spent: 3700 }] }] };
            case '2021-07':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600 }] }] };
            case '2021-08':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600 }] }] };
            case '2021-09':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600 }] }] };
            case '2021-10':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600 }] }] };
            case '2021-11':
                return { categoryGroups: [{ categories: [{ id: 'my-cat', budgeted: 10600 }] }] };
        }
    };
    // let last_month_balance = category.balance - category.spent - category.budgeted;
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 0, spent: 0, budgeted: 0 }, parsed['1'], '2021-01', () => {debugger} ) );
    test(template, 10000, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 4001, spent: -5999, budgeted: 0 }, parsed['1'], '2021-02', () => {debugger}) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', balance: 2616, spent: -11385, budgeted: 0 }, parsed['1'], '2021-03', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-04', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 3700, balance: 0 }, parsed['1'], '2021-05', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-06', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-07', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-08', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-09', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-10', getBudgetMonthTestFunc) );
    test(template, 10600, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-11', getBudgetMonthTestFunc) );
    test(template, 10599, await applyTemplate({ id: 'my-cat', name: 'my-cat', budgeted: 0, spent: 0, balance: 0 }, parsed['1'], '2021-12', getBudgetMonthTestFunc) );
}

function test(testName, expected, actual) {
    if(JSON.stringify(expected) === JSON.stringify(actual)) {
        console.log(colors.green(`${testName}: Passed`));
    } else {
        console.log(colors.red(`${testName}: Failed`));
        console.log(`          Expected: ${JSON.stringify(expected)}`)
        console.log(`            Actual: ${JSON.stringify(actual)}`)
        debugger;
    }
}