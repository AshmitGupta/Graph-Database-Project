const neo4j = require('neo4j-driver');
const xml2js = require('xml2js');
const fs = require('fs');

// Set to keep track of processed nodes to avoid duplicate creation/connection
const processedNodes = new Set();

async function createGraphFromXML(xmlData) {
    const driver = neo4j.driver('bolt://127.0.0.1:7687', neo4j.auth.basic('neo4j', 'password'), { encrypted: 'ENCRYPTION_OFF' });
    const session = driver.session();

    const uniqueLabel = 'Batch_2024_08_26'; // Original batch label

    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(xmlData);

        let docNumber = 'ServiceBulletin';
        if (result && result.AirplaneSB && result.AirplaneSB.$ && result.AirplaneSB.$.docnbr) {
            docNumber = result.AirplaneSB.$.docnbr;
            console.log(`Found docnbr: ${docNumber}`);
        } else {
            console.log('No docnbr attribute found; defaulting to "ServiceBulletin"');
        }

        console.log(`Creating Service Bulletin node with docnbr "${docNumber}" and label "${uniqueLabel}"`);
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: 'ServiceBulletin', content: '000', docnbr: $docnbr})`,
            { docnbr: docNumber }
        ));
        console.log('Service Bulletin node created.');

        function sanitizeRelationship(label) {
            return label.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        }

        function formatNodeLabel(label) {
            return label
                .replace(/^HAS_/, '')
                .toLowerCase()
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join('_');
        }

        function gatherContent(node) {
            let content = '';

            function handleTableNode(tableNode) {
                const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false }, xmldec: { version: '1.0', encoding: 'UTF-8' } });

                const sanitizedTable = JSON.parse(JSON.stringify(tableNode, (key, value) => (key.startsWith('$') ? undefined : value)));

                if (sanitizedTable.TABLE && Array.isArray(sanitizedTable.TABLE.ColSpec)) {
                    delete sanitizedTable.TABLE.ColSpec;
                }

                return builder.buildObject({ TABLE: sanitizedTable.TABLE }).trim();
            }

            for (const key in node) {
                if (node.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TABLE') {
                        content += handleTableNode({ TABLE: node[key] });
                    } else if (typeof node[key] === 'string' && !key.startsWith('$')) {
                        content += node[key] + ' ';
                    } else if (typeof node[key] === 'object' && !key.startsWith('$')) {
                        content += gatherContent(node[key]);
                    }
                }
            }

            return content.trim();
        }

        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];
                        const sanitizedRelationship = sanitizeRelationship(titleContent);
                        const titleNodeLabel = formatNodeLabel(sanitizedRelationship);
                        const nodeName = titleNodeLabel;

                        console.log(`Gathering content for "${titleNodeLabel}"`);
                        const concatenatedContent = gatherContent(obj);

                        const uniqueKey = `${nodeName}-${concatenatedContent.trim()}`;
                        if (processedNodes.has(uniqueKey)) {
                            console.log(`Node "${titleNodeLabel}" with content already processed, skipping.`);
                            continue;
                        }

                        processedNodes.add(uniqueKey);

                        console.log(`Creating TITLE node for "${titleNodeLabel}" with label "${uniqueLabel}"`);
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})`,
                            { name: nodeName, docnbr: docNumber }
                        ));
                        console.log(`TITLE node "${titleNodeLabel}" created.`);

                        if (!parentTitleNode) {
                            console.log(`Connecting TITLE "${titleNodeLabel}" to Service Bulletin`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (sb:ServiceBulletin:\`${uniqueLabel}\` {docnbr: $sbDocNbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (sb)-[:HAS_${sanitizedRelationship}]->(child)`,
                                { sbDocNbr: docNumber, childName: nodeName, docnbr: docNumber }
                            ));
                            console.log(`Connected "${titleNodeLabel}" to Service Bulletin.`);
                        } else {
                            const dynamicRelationship = `HAS_${sanitizedRelationship}`;
                            console.log(`Connecting TITLE "${parentNodeLabel}" to child TITLE "${titleNodeLabel}" with relationship "${dynamicRelationship}"`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName, docnbr: $docnbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentNodeLabel, childName: nodeName, docnbr: docNumber }
                            ));
                            console.log(`Connected "${parentNodeLabel}" to "${titleNodeLabel}" with "${dynamicRelationship}".`);
                        }

                        const cleanedContent = concatenatedContent.replace(/<ColSpec\s*\/>/g, '');

                        console.log(`Content for "${titleNodeLabel}" gathered: "${cleanedContent}"`);
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})
                            SET n.content = $content`,
                            { name: nodeName, content: cleanedContent, docnbr: docNumber }
                        ));
                        console.log(`Updated content for "${titleNodeLabel}".`);

                        console.log(`Processing nested content for "${titleNodeLabel}"...`);
                        await createTitleNodesAndRelationships(titleNodeLabel, titleNodeLabel, obj);
                    }

                    if (typeof obj[key] === 'object' && key.toUpperCase() !== 'TITLE') {
                        await createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj[key]);
                    }
                }
            }
        }

        console.log('Starting graph creation process...');
        const rootKey = Object.keys(result)[0];
        const rootObj = result[rootKey];
        await createTitleNodesAndRelationships(null, null, rootObj);

        console.log('Graph created successfully with docnbr property:', docNumber);
    } catch (error) {
        console.error('Error creating graph:', error);
    } finally {
        await session.close();
        await driver.close();
    }
}

fs.readFile('boeing_service_bulletin_1.xml', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading XML file:', err);
        return;
    }

    createGraphFromXML(data);
});
