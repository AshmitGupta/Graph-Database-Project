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

        // Helper function to derive meaningful label from content
        function getNodeLabel(content) {
            return content.replace(/\s+/g, '_').substring(0, 20); // Truncate and sanitize
        }

        // Recursive function for general parent-child relationships
        async function createNodesAndRelationships(parentNode, parentNodeLabel, obj, headers = []) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const content = typeof obj[key] === 'string' ? obj[key] : null;
                    const nodeLabel = getNodeLabel(content || key); // Meaningful node label
                    const sanitizedLabel = sanitizeLabel(nodeLabel); // Sanitize label

                    // Handle case for non-structural elements (standard nodes)
                    if (content) {
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${sanitizedLabel}\`:\`${uniqueLabel}\` {name: $name, content: $content})`,
                            { name: nodeLabel, content: content }
                        ));
                    } else {
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${sanitizedLabel}\`:\`${uniqueLabel}\` {name: $name})`,
                            { name: nodeLabel }
                        ));
                    }

                    // If parent node exists, create relationship
                    if (parentNode && parentNodeLabel) {
                        const sanitizedParentLabel = sanitizeLabel(parentNodeLabel);
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (parent:\`${sanitizedParentLabel}\`:\`${uniqueLabel}\` {name: $parentName}), (child:\`${sanitizedLabel}\`:\`${uniqueLabel}\` {name: $childName})
                            MERGE (parent)-[:HAS_${sanitizedLabel}]->(child)`,
                            { parentName: parentNodeLabel, childName: nodeLabel }
                        ));
                    }

                    // Handle special cases for TABLE structure
                    if (key.toUpperCase() === 'THEAD') {
                        const headerLabels = obj[key].ROW.CELL.map(cell => cell.PARA); // Extract headers
                        headers = headerLabels.map(header => sanitizeLabel(header.replace(/\s+/g, '_').substring(0, 20)));

                        // Create header nodes
                        for (const header of headers) {
                            await session.writeTransaction(tx => tx.run(
                                `MERGE (h:\`${header}\`:\`${uniqueLabel}\` {name: $name})`,
                                { name: header }
                            ));
                        }
                    } else if (key.toUpperCase() === 'TBODY') {
                        const rows = obj[key].ROW;
                        for (let i = 0; i < rows.length; i++) {
                            const rowNodeLabel = `Row_${i + 1}`; // Label for the row
                            await session.writeTransaction(tx => tx.run(
                                `MERGE (r:\`${rowNodeLabel}\`:\`${uniqueLabel}\`)`
                            ));

                            const cells = rows[i].CELL;
                            for (let j = 0; j < cells.length; j++) {
                                const cellContent = cells[j].PARA ? getNodeLabel(cells[j].PARA) : `Empty_Content`;
                                const header = headers[j] || `Header_${j}`; // Link to the corresponding header

                                // Create Cell Content
                                await session.writeTransaction(tx => tx.run(
                                    `MERGE (content:\`${cellContent}\`:\`${uniqueLabel}\` {name: $name})`,
                                    { name: cellContent }
                                ));

                                // Link Header to Cell Content
                                await session.writeTransaction(tx => tx.run(
                                    `MATCH (header:\`${header}\`:\`${uniqueLabel}\`), (content:\`${cellContent}\`:\`${uniqueLabel}\`)
                                    MERGE (header)-[:HEADER_OF]->(content)`
                                ));

                                // Link Row to Cell Content
                                await session.writeTransaction(tx => tx.run(
                                    `MATCH (row:\`${rowNodeLabel}\`:\`${uniqueLabel}\`), (content:\`${cellContent}\`:\`${uniqueLabel}\`)
                                    MERGE (row)-[:CONTAINS]->(content)`
                                ));
                            }
                        }
                    }

                    // Recur for nested objects
                    if (typeof obj[key] === 'object') {
                        await createNodesAndRelationships(nodeLabel, nodeLabel, obj[key], headers);
                    }
                }
            }
        }

        const rootLabel = Object.keys(result)[0];
        await createNodesAndRelationships(null, null, result[rootLabel]);

        console.log('Graph created successfully with unique label:', uniqueLabel);
    } catch (error) {
        console.error('Error creating graph:', error);
    } finally {
        await session.close();
        await driver.close();
    }
}

fs.readFile('your_xml_data.xml', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading XML file:', err);
        return;
    }

    createGraphFromXML(data);
});
