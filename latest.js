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

        async function createNodesAndRelationships(parentNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const nodeLabel = isNaN(key.charAt(0)) ? key : `Tag_${key}`;
                    const content = typeof obj[key] === 'string' ? obj[key] : null;

                    if (content) {
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${nodeLabel}\`:\`${uniqueLabel}\` {name: $name, content: $content})`,
                            { name: nodeLabel, content: content }
                        ));
                    } else {
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${nodeLabel}\`:\`${uniqueLabel}\` {name: $name})`,
                            { name: nodeLabel }
                        ));
                    }

                    if (parentNode && parentNodeLabel) {
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName}), (child:\`${nodeLabel}\`:\`${uniqueLabel}\` {name: $childName})
                            MERGE (parent)-[:HAS_${nodeLabel.toUpperCase()}]->(child)
                            MERGE (child)-[:IS_PART_OF]->(parent)`,
                            { parentName: parentNodeLabel, childName: nodeLabel }
                        ));
                    }

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
