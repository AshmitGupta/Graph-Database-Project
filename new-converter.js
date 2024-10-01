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

        // Helper function to sanitize labels
        function sanitizeLabel(label) {
            return label.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
        }

        // Helper function to recursively gather content under a TITLE node
        function gatherContent(node) {
            let content = '';

            // Recursively go through each child node
            for (const key in node) {
                if (node.hasOwnProperty(key)) {
                    if (typeof node[key] === 'string') {
                        content += node[key] + ' '; // Accumulate string content
                    } else if (typeof node[key] === 'object') {
                        // If it's an object (nested structure), recurse into it
                        content += gatherContent(node[key]);
                    }
                }
            }

            return content.trim(); // Remove extra spaces
        }

        // Create the initial "Service Bulletin" node
        console.log('Creating Service Bulletin node with content "000"');
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: 'Service Bulletin', content: '000'})`
        ));
        console.log('Service Bulletin node created.');

        // Function to create nodes and relationships for TITLE nodes
        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    // If the key is a TITLE, create a node for it
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];  // Title content (e.g., "Title 1")
                        const titleNodeLabel = sanitizeLabel(titleContent);  // Node label based on title content

                        // Check if the node has already been processed
                        if (processedNodes.has(titleContent)) {
                            console.log(`Node "${titleContent}" already processed, skipping.`);
                            continue;
                        }

                        // Mark this node as processed
                        processedNodes.add(titleContent);

                        // Log the creation of the TITLE node
                        console.log(`Creating TITLE node for "${titleContent}"`);
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})`,
                            { name: titleContent }
                        ));
                        console.log(`TITLE node "${titleContent}" created.`);

                        // If no parent TITLE (top-level), connect to the Service Bulletin node
                        if (!parentTitleNode) {
                            console.log(`Connecting TITLE "${titleContent}" to Service Bulletin`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (sb:ServiceBulletin:\`${uniqueLabel}\` {name: 'Service Bulletin'}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                                MERGE (sb)-[:HAS_${sanitizeLabel(titleContent)}]->(child)`,
                                { childName: titleContent }
                            ));
                            console.log(`Connected "${titleContent}" to Service Bulletin.`);
                        } else {
                            // If there's a parent TITLE, create a dynamic relationship to this child TITLE
                            const dynamicRelationship = `HAS_${sanitizeLabel(titleContent)}`;
                            console.log(`Connecting TITLE "${parentTitleNode}" to child TITLE "${titleContent}" with relationship "${dynamicRelationship}"`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentTitleNode, childName: titleContent }
                            ));
                            console.log(`Connected "${parentTitleNode}" to "${titleContent}" with "${dynamicRelationship}".`);
                        }

                        // Concatenate content from other tags within the same structure (including nested objects)
                        console.log(`Gathering content for "${titleContent}"`);
                        const concatenatedContent = gatherContent(obj);
                        console.log(`Content for "${titleContent}" gathered: "${concatenatedContent}"`);

                        // Update the TITLE node with the concatenated content
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})
                            SET n.content = $content`,
                            { name: titleContent, content: concatenatedContent }
                        ));
                        console.log(`Updated content for "${titleContent}".`);

                        // Recursively process nested objects, passing the current title as the parent
                        console.log(`Processing nested content for "${titleContent}"...`);
                        await createTitleNodesAndRelationships(titleContent, titleNodeLabel, obj);
                    }

                    // Recursively process nested objects, skip TITLE nodes as we already handle them
                    if (typeof obj[key] === 'object') {
                        await createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj[key]);
                    }
                }
            }
        }

        // Start the graph creation with the root node (e.g., "SUBJECT")
        console.log('Starting graph creation process...');
        const rootLabel = Object.keys(result)[0];
        await createTitleNodesAndRelationships(null, null, result[rootLabel]);

        console.log('Graph created successfully with unique label:', uniqueLabel);
    } catch (error) {
        console.error('Error creating graph:', error);
    } finally {
        await session.close();
        await driver.close();
    }
}

// Read the XML file
fs.readFile('boeing_service_bulletin_1.xml', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading XML file:', err);
        return;
    }

    createGraphFromXML(data);
});
