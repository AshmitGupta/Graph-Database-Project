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

            // Recursively go through each child node
            for (const key in node) {
                if (node.hasOwnProperty(key)) {
                    if (typeof node[key] === 'string' && !key.startsWith('$')) { // Skip keys starting with '$' (i.e., attributes)
                        content += node[key] + ' '; // Accumulate string content
                    } else if (typeof node[key] === 'object' && !key.startsWith('$')) {
                        // If it's an object (nested structure) and not an attribute, recurse into it
                        content += gatherContent(node[key]);
                    }
                }
            }

            return content.trim(); // Remove extra spaces
        }

        // Create the initial "Service Bulletin" node
        console.log('Creating Service Bulletin node with content "000"');
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: 'ServiceBulletin', content: '000'})`
        ));
        console.log('Service Bulletin node created.');

        // Function to create nodes and relationships for TITLE nodes
        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    // If the key is a TITLE, create a node for it
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];  // Title content (e.g., "Title 1")
                        const sanitizedRelationship = sanitizeRelationship(titleContent);
                        const titleNodeLabel = formatNodeLabel(sanitizedRelationship);  // Node label based on title content
                        const nodeName = titleNodeLabel; // Set the name property to match the formatted label

                        // Check if the node has already been processed
                        if (processedNodes.has(titleNodeLabel)) {
                            console.log(`Node "${titleNodeLabel}" already processed, skipping.`);
                            continue;
                        }

                        // Mark this node as processed
                        processedNodes.add(titleNodeLabel);

                        // Log the creation of the TITLE node
                        console.log(`Creating TITLE node for "${titleNodeLabel}"`);
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})`,
                            { name: nodeName } // Set the node name to match the formatted label
                        ));
                        console.log(`TITLE node "${titleNodeLabel}" created.`);

                        // If no parent TITLE (top-level), connect to the Service Bulletin node
                        if (!parentTitleNode) {
                            console.log(`Connecting TITLE "${titleNodeLabel}" to Service Bulletin`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (sb:ServiceBulletin:\`${uniqueLabel}\` {name: 'ServiceBulletin'}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                                MERGE (sb)-[:HAS_${sanitizedRelationship}]->(child)`,
                                { childName: nodeName } // Use the new formatted nodeName for connections
                            ));
                            console.log(`Connected "${titleNodeLabel}" to Service Bulletin.`);
                        } else {
                            // If there's a parent TITLE, create a dynamic relationship to this child TITLE
                            const dynamicRelationship = `HAS_${sanitizedRelationship}`;
                            console.log(`Connecting TITLE "${parentNodeLabel}" to child TITLE "${titleNodeLabel}" with relationship "${dynamicRelationship}"`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentNodeLabel, childName: nodeName } // Use the new formatted nodeName for connections
                            ));
                            console.log(`Connected "${parentNodeLabel}" to "${titleNodeLabel}" with "${dynamicRelationship}".`);
                        }

                        // Gather and update content for the node
                        console.log(`Gathering content for "${titleNodeLabel}"`);
                        const concatenatedContent = gatherContent(obj);
                        console.log(`Content for "${titleNodeLabel}" gathered: "${concatenatedContent}"`);

                        // Update the TITLE node with the concatenated content
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})
                            SET n.content = $content`,
                            { name: nodeName, content: concatenatedContent }
                        ));
                        console.log(`Updated content for "${titleNodeLabel}".`);

                        // Recursively process nested objects, passing the current title as the parent
                        console.log(`Processing nested content for "${titleNodeLabel}"...`);
                        await createTitleNodesAndRelationships(titleNodeLabel, titleNodeLabel, obj);
                    }

                    // Recursively process nested objects, skip TITLE nodes as we already handle them
                    if (typeof obj[key] === 'object' && key.toUpperCase() !== 'TITLE') {
                        await createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj[key]);
                    }
                }
            }
        }

        // Start the graph creation with the root node (e.g., "SUBJECT")
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

// Read the XML file
fs.readFile('boeing_service_bulletin_1.xml', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading XML file:', err);
        return;
    }

    createGraphFromXML(data);
});
