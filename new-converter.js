const neo4j = require('neo4j-driver');
const xml2js = require('xml2js');
const fs = require('fs');

// Set to keep track of processed nodes to avoid duplicate creation/connection
const processedNodes = new Set();

async function createGraphFromXML(xmlData) {
    const driver = neo4j.driver('bolt://127.0.0.1:7687', neo4j.auth.basic('neo4j', 'password'), { encrypted: 'ENCRYPTION_OFF' });
    const session = driver.session();

    const uniqueLabel = 'Batch_2024_08_26';

    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(xmlData);

        // Extract the "docnbr" attribute from "AirplaneSB" if available
        let docNumber = 'ServiceBulletin'; // Default name
        if (result && result.AirplaneSB && result.AirplaneSB.$ && result.AirplaneSB.$.docnbr) {
            docNumber = result.AirplaneSB.$.docnbr; // Set docNumber if "docnbr" exists
            console.log(`Found docnbr: ${docNumber}`);
        } else {
            console.log('No docnbr attribute found; defaulting to "ServiceBulletin"');
        }

        // Create the initial "Service Bulletin" node with docNumber as name
        console.log(`Creating Service Bulletin node with name "${docNumber}"`);
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: $name, content: '000'})`,
            { name: docNumber }
        ));
        console.log('Service Bulletin node created.');

        // Helper function to sanitize relationships
        function sanitizeRelationship(label) {
            return label.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        }

        // Helper function to format node labels correctly by converting the relationship name to UpperCamelCase
        function formatNodeLabel(label) {
            // Remove "HAS_" prefix and convert to UpperCamelCase
            return label
                .replace(/^HAS_/, '') // Remove the "HAS_" prefix
                .toLowerCase() // Convert to lowercase
                .split('_') // Split by underscore
                .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize first letter of each word
                .join('_'); // Join the parts back together with an underscore
        }

        // Helper function to recursively gather content under a TITLE node
        function gatherContent(node) {
            let content = '';

            // Function to handle the <TABLE> tag
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

        // Function to create nodes and relationships for TITLE nodes
        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];
                        const sanitizedRelationship = sanitizeRelationship(titleContent);
                        const titleNodeLabel = formatNodeLabel(sanitizedRelationship);
                        const nodeName = titleNodeLabel;

                        // Gather and update content for the node
                        console.log(`Gathering content for "${titleNodeLabel}"`);
                        const concatenatedContent = gatherContent(obj);
                        
                        const uniqueKey = `${nodeName}-${concatenatedContent.trim()}`;

                        if (processedNodes.has(uniqueKey)) {
                            console.log(`Node "${titleNodeLabel}" with content already processed, skipping.`);
                            continue;
                        }

                        processedNodes.add(uniqueKey);

                        // Log the creation of the TITLE node
                        console.log(`Creating TITLE node for "${titleNodeLabel}"`);
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})`,
                            { name: nodeName }
                        ));
                        console.log(`TITLE node "${titleNodeLabel}" created.`);

                        if (!parentTitleNode) {
                            console.log(`Connecting TITLE "${titleNodeLabel}" to Service Bulletin`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (sb:ServiceBulletin:\`${uniqueLabel}\` {name: $name}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                                MERGE (sb)-[:HAS_${sanitizedRelationship}]->(child)`,
                                { name: docNumber, childName: nodeName }
                            ));
                            console.log(`Connected "${titleNodeLabel}" to Service Bulletin.`);
                        } else {
                            const dynamicRelationship = `HAS_${sanitizedRelationship}`;
                            console.log(`Connecting TITLE "${parentNodeLabel}" to child TITLE "${titleNodeLabel}" with relationship "${dynamicRelationship}"`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentNodeLabel, childName: nodeName }
                            ));
                            console.log(`Connected "${parentNodeLabel}" to "${titleNodeLabel}" with "${dynamicRelationship}".`);
                        }

                        const cleanedContent = concatenatedContent.replace(/<ColSpec\s*\/>/g, '');

                        console.log(`Content for "${titleNodeLabel}" gathered: "${cleanedContent}"`);

                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})
                            SET n.content = $content`,
                            { name: nodeName, content: cleanedContent }
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

        console.log('Graph created successfully with unique label:', uniqueLabel);
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
