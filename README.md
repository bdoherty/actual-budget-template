# actual-budget-template
Command line utility for applying a budget template to [ActualBudget](https://actualbudget.com/).

## Synopsis
```
node index.js <budget-id> [month] [--preview] [--force]
```
* **budget-id** You can find your budget id in the "Advanced" section of the settings page. 
* **month** The month in yyyy-MM format that you want to apply the budget template to.  Defaults to the current month.
* **--preview** Displays a preview of what changes will be made, without doing any updates.
* **--force** Applies to the budget template to all categories, even those with a *Budgeted* value.  Can be combined with *--preview*.

This utility uses the [Actual API](https://actualbudget.com/docs/developers/using-the-API/). Currently, the API requires Actual must be running locally beore you can apply a budget template.

## Template

Create a template by adding a note to a category and adding a line that begins with ```#template```.  

![category_note](https://user-images.githubusercontent.com/335468/141658974-1fb72d02-d30d-4c24-826a-eb2574e360d5.png)

You are welcome to have other lines in your note, but the ```#template``` line must match the syntax.

| Syntax | Description | How I use this |
| ------ | --- | --- |
| ```#template $50``` | Budget $50 each month | Regular monthly bills, such as internet |
| ```#template up to $150``` | Budget up to $150 each month | Variable expenses, such as petrol and groceries |
| ```#template $50 up to $300``` | Budget $50 each month up to a maximum of $300 | Funding rainy day categories, such as replacement shoes and bicycle repairs |
| ```#template $500 by 2022‑03``` | Break down large, less-frequent expenses into manageable monthly expenses | Saving for a replacement car in a few years |
| ```#template $500 by 2021‑03 repeat every 6 months``` | Break down large, less-frequent expenses into manageable monthly expenses | Biannual credit card fees |
| ```#template $500 by 2021‑03 repeat every year``` | Break down large, less-frequent expenses into manageable monthly expenses | Annual insurance premium |
| ```#template $500 by 2021‑03 repeat every 2 years``` | Break down large, less-frequent expenses into manageable monthly expenses | Domain name renewal |
| ```#template $500 by 2021‑12 spend from 2021-03``` | Budget $500 by December. Any spending between March and December is OK. | Christmas presents, overseas holiday, or any other expenses that I will be partially paying for before the target period ends. |




### Notes
* $ sign is optional, ```#template $50``` and ```#template 50``` are the same.
* Other currency symbols are not supported.
* Number formats that use comma for the decimal seperator are not supported (eg, ```123,45```). You must use ```123.45```.
* Thousands separators are not supported (eg, ```1,234```).  You must use ```1234```.

## Prerequisites
* Actual
* Node

## How to get started.
Before you first run this tool, you'll need to run ```npm install``` to install the dependencies.

# Buy Me A Coffee! :coffee:

Find this tool useful?  Feel free to do it at [__Buy me a coffee! :coffee:__](https://www.buymeacoffee.com/bdoherty), I will be really thankfull for anything even if it is a coffee or just a kind comment towards my work, because that helps me a lot. Whenever you contribute with a donation, I will read your message and it will be shown in my main site.

buymeacoffee is a website that contacts developers, designers, artists, etc. with their communities so that people can contribute and help them out so that the content they offer is better since the rewarding system encourages creators to continue doing what they like and helping others.

Please make sure that you have subscribed to Actual Budget before donating, as James has created a fantastic product.

### Be careful and donate just if it is within your possibilities, because there is no refund system. And remember that you don't need to donate, it is just a free choice for you. Thank you!

# License and Disclaimer
[MIT License](LICENSE)

The developer of this tool is not associated with Actual Budget.  Any issues with this tool should be directed here and not to Actual Budget support.

