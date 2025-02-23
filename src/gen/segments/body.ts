import { Entity } from "../types";
import { convertType, mapType } from "../util";

/**
 * Required imports and primitive types required for other functions
 * @returns Text to be injected for the heading
 */
export function heading() {
return `
import Wei, { WeiSource, wei } from '@synthetixio/wei';
import axios from 'codegen-graph-ts/build/src/lib/axios';
import generateGql from 'codegen-graph-ts/build/src/lib/gql';

export type SingleQueryOptions = {
    id: string,
    block?: { 'number': number }|{ hash: string },
};

export type MultiQueryOptions<T, R> = {
    first?: number,
    where?: T,
    block?: { 'number': number }|{ hash: string },
    orderBy?: keyof R,
    orderDirection?: 'asc'|'desc' 
};

const MAX_PAGE = 1000;
`;
}

function queryFunctionName(e: Entity) {
    return e.name.replace(/^./, e.name[0].toLowerCase());
}

function injectParse(e: Entity) {
    const out = [`const formattedObj: any = {};`];
    for (const f of e.fields!) {
        const t = convertType(f.type);
        switch(t.name) {
            case 'BigDecimal':
                out.push(`if (obj['${f.name}']) formattedObj['${f.name}'] = wei(obj['${f.name}']);`);
                break;
            case 'BigInt':
                out.push(`if (obj['${f.name}']) formattedObj['${f.name}'] = wei(obj['${f.name}'], 0);`);
                break;
            default:
                out.push(`if (obj['${f.name}']) formattedObj['${f.name}'] = obj['${f.name}'];`)
        }
    }

    return out.join('\n');
}

/**
 * Generates an async function body for fetching and parsing query options
 */
export function multiBody(e: Entity) {
return `async function<K extends keyof ${e.name}Result>(url: string, options: MultiQueryOptions<${e.name}Filter, ${e.name}Result>, args: ${e.name}Args<K>): Promise<Pick<${e.name}Result, K>[]> {

    const paginatedOptions: Partial<MultiQueryOptions<${e.name}Filter, ${e.name}Result>> = { ...options };

    let paginationKey: keyof ${e.name}Filter|null = null;
    let paginationValue = '';

    if (options.first && options.first > MAX_PAGE) {
        paginatedOptions.first = MAX_PAGE;

        paginatedOptions.orderBy = options.orderBy || 'id';
        paginatedOptions.orderDirection = options.orderDirection || 'asc';

        paginationKey = paginatedOptions.orderBy + (paginatedOptions.orderDirection === 'asc' ? '_gt' : '_lt') as keyof ${e.name}Filter;

        paginatedOptions.where =  { ...options.where };
    }

    let results: Pick<${e.name}Result, K>[] = [];

    do {
        if (paginationKey && paginationValue) paginatedOptions.where![paginationKey] = paginationValue as any;

        const res = await axios.post(url, {
            query: generateGql('${queryFunctionName(e)}s', paginatedOptions, args)
        });

        const r = res.data as any;

        if (r.errors && r.errors.length) {
            throw new Error(r.errors[0].message);
        }

        const rawResults = r.data[Object.keys(r.data)[0]] as any[];

        const newResults = rawResults.map((obj) => {
            ${injectParse(e)}
                return formattedObj as Pick<${e.name}Result, K>;
        });

        results = results.concat(newResults);

        if (newResults.length < 1000) {
            break;
        }
        
        if (paginationKey) {
            paginationValue = rawResults[rawResults.length - 1][paginatedOptions.orderBy!];
        }
    } while (paginationKey && (options.first && results.length < options.first));

    return options.first ? results.slice(0, options.first) : results;
}`;
}

/**
 * Generates an async function body for fetching and parsing query options
 */
export function singleBody(e: Entity) {
return `async function<K extends keyof ${e.name}Result>(url: string, options: SingleQueryOptions, args: ${e.name}Args<K>): Promise<Pick<${e.name}Result, K>> {
    const res = await axios.post(url, {
        query: generateGql('${queryFunctionName(e)}', options, args)
    });

    const r = res.data as any;

    if (r.errors && r.errors.length) {
        throw new Error(r.errors[0].message);
    }

    const obj = (r.data[Object.keys(r.data)[0]] as any);
${injectParse(e)}
    return formattedObj as Pick<${e.name}Result, K>;
}`;
}

export function types(entity: Entity, filterEntity: Entity) {
    const lines: string[] = [];
lines.push(`export type ${entity.name}Filter = {`);
for (const field of filterEntity.inputFields!) {
    lines.push(`\t${field.name}?: ${mapType(field.type, 'Filter').tsTypeName}`);
}
lines.push('};');
lines.push('\n');

lines.push(`export type ${entity.name}Result = {`);
for (const field of entity.fields!) {
    lines.push(`\t${field.name}: ${mapType(field.type, 'Result').tsTypeName}`);
}
lines.push(`};`);

lines.push(`export type ${entity.name}Fields = {`);
for (const field of entity.fields!) {
    const mappedType = mapType(field.type, 'Fields');
    lines.push(`\t${field.name}: ${mappedType.nestedStructure ? mappedType.baseType : true}`);
}
lines.push(`};`);

lines.push(`export type ${entity.name}Args<K extends keyof ${entity.name}Result> = { [Property in keyof Pick<${entity.name}Fields, K>]: ${entity.name}Fields[Property] };`);

lines.push('');

    return lines.join('\n');
}