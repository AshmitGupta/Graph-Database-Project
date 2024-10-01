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

        // Helper function to sanitize relationship names
        function sanitizeLabel(label) {
            return label.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
        }

        // Specialized logic for handling tables
        async function handleTableStructure(headers, rows) {
            // Create header nodes
            for (const header of headers) {
                const sanitizedHeader = sanitizeLabel(header);
                await session.writeTransaction(tx => tx.run(
                    `MERGE (h:\`${sanitizedHeader}\`:\`${uniqueLabel}\` {name: $name})`,
                    { name: header }
                ));
            }

            // Create row and cell relationships
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNodeLabel = `Row_${i + 1}`;

                // Create row node
                await session.writeTransaction(tx => tx.run(
                    `MERGE (r:\`${rowNodeLabel}\`:\`${uniqueLabel}\`)`
                ));

                // Create cells and link to headers and row
                for (let j = 0; j < row.length; j++) {
                    const cellContent = sanitizeLabel(row[j]);
                    const header = headers[j] || `Header_${j}`;

                    // Create cell content node
                    await session.writeTransaction(tx => tx.run(
                        `MERGE (c:\`${cellContent}\`:\`${uniqueLabel}\` {name: $name})`,
                        { name: row[j] }
                    ));

                    // Link header to cell content
                    await session.writeTransaction(tx => tx.run(
                        `MATCH (h:\`${sanitizeLabel(header)}\`:\`${uniqueLabel}\`), (c:\`${cellContent}\`:\`${uniqueLabel}\`)
                        MERGE (h)-[:HEADER_OF]->(c)`
                    ));

                    // Link row to cell content
                    await session.writeTransaction(tx => tx.run(
                        `MATCH (r:\`${rowNodeLabel}\`:\`${uniqueLabel}\`), (c:\`${cellContent}\`:\`${uniqueLabel}\`)
                        MERGE (r)-[:CONTAINS]->(c)`
                    ));
                }
            }
        }

        async function createNodesAndRelationships(parentNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const nodeLabel = isNaN(key.charAt(0)) ? key : `Tag_${key}`;
                    const sanitizedLabel = sanitizeLabel(nodeLabel); // Sanitize label
                    const content = typeof obj[key] === 'string' ? obj[key] : null;

                    // Handle tables if THEAD/TBODY tags are found
                    if (key.toUpperCase() === 'THEAD') {
                        const headers = obj[key].ROW.CELL.map(cell => cell.PARA); // Extract headers
                        const tbody = obj.TBODY;
                        const rows = tbody.ROW.map(row => row.CELL.map(cell => cell.PARA)); // Extract row cells
                        await handleTableStructure(headers, rows);
                        continue; // Skip further processing for this key since we handle it here
                    }

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

                    // Parent-child relationship, without bidirectional relationship
                    if (parentNode && parentNodeLabel) {
                        const sanitizedParentLabel = sanitizeLabel(parentNodeLabel);
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (parent:\`${sanitizedParentLabel}\`:\`${uniqueLabel}\` {name: $parentName}), (child:\`${sanitizedLabel}\`:\`${uniqueLabel}\` {name: $childName})
                            MERGE (parent)-[:HAS_${sanitizedLabel}]->(child)`,
                            { parentName: parentNodeLabel, childName: nodeLabel }
                        ));
                    }

                    // Recursively process nested objects
                    if (typeof obj[key] === 'object') {
                        await createNodesAndRelationships(nodeLabel, nodeLabel, obj[key]);
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

fs.readFile('boeing_service_bulletin_1.xml', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading XML file:', err);
        return;
    }

    createGraphFromXML(data);
});
