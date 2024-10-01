const neo4j = require('neo4j-driver');
const xml2js = require('xml2js');
const fs = require('fs');

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

        // Function to create nodes and relationships for TITLE nodes
        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    // If the key is a TITLE, create a node for it
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];  // Title content (e.g., "Title 1")
                        const titleNodeLabel = sanitizeLabel(titleContent);  // Node label based on title content

                        // Create the TITLE node
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})`,
                            { name: titleContent }
                        ));

                        // If there is a parent TITLE, create a dynamic relationship to this child TITLE
                        if (parentTitleNode) {
                            const dynamicRelationship = `HAS_${sanitizeLabel(titleContent)}`;
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentTitleNode, childName: titleContent }
                            ));
                        }

                        // Concatenate content from other tags within the same structure (e.g., PARA, REASON)
                        let concatenatedContent = '';
                        for (const subKey in obj) {
                            if (subKey !== 'TITLE' && typeof obj[subKey] === 'string') {
                                concatenatedContent += obj[subKey] + ' ';  // Add space between each concatenated content
                            }
                        }

                        // Update the TITLE node with the concatenated content
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name})
                            SET n.content = $content`,
                            { name: titleContent, content: concatenatedContent.trim() }
                        ));

                        // Recursively process nested objects
                        await createTitleNodesAndRelationships(titleContent, titleNodeLabel, obj);
                    }

                    // Recursively process nested objects, skip TITLE nodes as we already handle them
                    if (typeof obj[key] === 'object') {
                        await createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj[key]);
                    }
                }
            }
        }

        // Start the graph creation with the root node
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
